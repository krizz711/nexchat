const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');
const supabase = require('../db/supabase');
const { getActiveUser } = require('../socket/socketHandler');

let _io = null;
const router = express.Router();

router.use(authMiddleware);

const friendshipKey = (a, b) => a < b ? [a, b] : [b, a];

const acceptRequest = async (requestId, acceptorId, requesterId, res) => {
    const { error: updateError } = await supabase
        .from('friend_requests')
        .update({ status: 'accepted' })
        .eq('id', requestId);

    if (updateError) return res.status(500).json({ error: 'Database error accepting request' });

    const [user_a_id, user_b_id] = friendshipKey(acceptorId, requesterId);

    const { data: friendship, error: upsertError } = await supabase
        .from('friendships')
        .upsert(
            { user_a_id, user_b_id, friends_since: new Date().toISOString() },
            { onConflict: 'user_a_id,user_b_id' }
        )
        .select()
        .single();

    if (upsertError) return res.status(500).json({ error: 'Database error creating friendship' });

    return res.json(friendship);
};

// GET / => Query friendships table joining users on both user_a_id and user_b_id.
router.get('/', async (req, res) => {
    try {
        const { data: friendships, error } = await supabase
            .from('friendships')
            .select(`
        id,
        friends_since,
        user_a_id,
        user_b_id,
        user_a:users!friendships_user_a_id_fkey (id, username, avatar_url, bio, star_count, country, state, gender, age, calls_enabled),
        user_b:users!friendships_user_b_id_fkey (id, username, avatar_url, bio, star_count, country, state, gender, age, calls_enabled)
      `)
            .or(`user_a_id.eq.${req.user.id},user_b_id.eq.${req.user.id}`);

        if (error) {
            const { data: fallbackFriendships, error: fallbackError } = await supabase
                .from('friendships')
                .select(`
          id,
          friends_since,
          user_a_id,
          user_b_id,
          user_a:user_a_id (id, username, avatar_url, bio, star_count, country, state, gender, age, calls_enabled),
          user_b:user_b_id (id, username, avatar_url, bio, star_count, country, state, gender, age, calls_enabled)
        `)
                .or(`user_a_id.eq.${req.user.id},user_b_id.eq.${req.user.id}`);

            if (fallbackError) return res.status(500).json({ error: 'Database query failed' });

            const friendsListInfo = fallbackFriendships.map(f => {
                const friendData = f.user_a_id === req.user.id ? f.user_b : f.user_a;
                return {
                    ...friendData,
                    friendship_id: f.id,
                    friends_since: f.friends_since,
                };
            });
            return res.json(friendsListInfo);
        }

        const friendsList = friendships.map(f => {
            const friendData = f.user_a_id === req.user.id ? f.user_b : f.user_a;
            return {
                ...friendData,
                friendship_id: f.id,
                friends_since: f.friends_since,
            };
        });

        res.json(friendsList);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /requests => Query friend_requests where to_user_id = current user id and status = pending.
router.get('/requests', async (req, res) => {
    try {
        const { data: requests, error } = await supabase
            .from('friend_requests')
            .select('id, created_at, from_user:from_user_id (id, username, avatar_url, star_count)')
            .eq('to_user_id', req.user.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: 'Database query failed' });

        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /request/:userId
router.post('/request/:userId', async (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot send friend requests' });

    const targetId = req.params.userId;
    if (req.user.id === targetId) return res.status(400).json({ error: 'Cannot friend yourself' });
    if (targetId.startsWith('guest_')) return res.status(403).json({ error: 'Cannot friend guests' });

    const [user_a_id, user_b_id] = friendshipKey(req.user.id, targetId);

    try {
        const { data: existingFriendship, error: friendshipError } = await supabase
            .from('friendships')
            .select('id')
            .eq('user_a_id', user_a_id)
            .eq('user_b_id', user_b_id)
            .maybeSingle();

        if (friendshipError) return res.status(500).json({ error: 'Database query failed' });
        if (existingFriendship) return res.status(409).json({ error: 'Already friends' });

        const { data: existingRequests, error: reqError } = await supabase
            .from('friend_requests')
            .select('id, from_user_id, to_user_id, status')
            .eq('status', 'pending')
            .or(`and(from_user_id.eq.${req.user.id},to_user_id.eq.${targetId}),and(from_user_id.eq.${targetId},to_user_id.eq.${req.user.id})`);

        if (reqError) return res.status(500).json({ error: 'Database query failed' });

        if (existingRequests && existingRequests.length > 0) {
            const existingReq = existingRequests[0];
            if (existingReq.from_user_id === targetId) {
                return await acceptRequest(existingReq.id, req.user.id, targetId, res);
            }
            return res.status(409).json({ error: 'Friend request already sent' });
        }

        const { data: request, error: insertError } = await supabase
            .from('friend_requests')
            .insert({
                from_user_id: req.user.id,
                to_user_id: targetId,
                status: 'pending'
            })
            .select()
            .single();

        if (insertError) return res.status(500).json({ error: 'Failed to send friend request' });

        try {
            const { data: senderInfo } = await supabase
                .from('users')
                .select('id, username, avatar_url, star_count')
                .eq('id', req.user.id)
                .single();

            const activeTarget = getActiveUser(targetId);
            if (activeTarget && _io) {
                activeTarget.socketIds.forEach(sid => {
                    const targetSocket = _io.sockets.sockets.get(sid);
                    if (targetSocket) {
                        targetSocket.emit('friend:request', {
                            request: {
                                id: request.id,
                                created_at: request.created_at,
                                from_user: senderInfo,
                            }
                        });
                    }
                });
            }
        } catch (emitErr) {
            console.error('Failed to emit friend:request', emitErr);
        }

        res.json(request);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /accept/:requestId
router.post('/accept/:requestId', async (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot accept friend requests' });

    const requestId = req.params.requestId;

    try {
        const { data: request, error } = await supabase
            .from('friend_requests')
            .select('from_user_id')
            .eq('id', requestId)
            .eq('to_user_id', req.user.id)
            .eq('status', 'pending')
            .single();

        if (error || !request) return res.status(404).json({ error: 'Friend request not found' });

        await acceptRequest(requestId, req.user.id, request.from_user_id, res);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /decline/:requestId
router.post('/decline/:requestId', async (req, res) => {
    const requestId = req.params.requestId;

    try {
        const { error } = await supabase
            .from('friend_requests')
            .update({ status: 'declined' })
            .eq('id', requestId)
            .eq('to_user_id', req.user.id);

        if (error) return res.status(500).json({ error: 'Failed to decline request' });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /:userId
router.delete('/:userId', async (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot have friends' });

    const targetId = req.params.userId;
    const [user_a_id, user_b_id] = friendshipKey(req.user.id, targetId);

    try {
        const { error } = await supabase
            .from('friendships')
            .delete()
            .eq('user_a_id', user_a_id)
            .eq('user_b_id', user_b_id);

        if (error) return res.status(500).json({ error: 'Failed to delete friendship' });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /settings
router.put('/settings', async (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot update settings' });

    const { calls_enabled, notification_sound } = req.body;
    const updateData = {};
    if (typeof calls_enabled === 'boolean') updateData.calls_enabled = calls_enabled;
    if (typeof notification_sound === 'boolean') updateData.notification_sound = notification_sound;

    if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'No valid settings provided' });

    try {
        const { data: updatedUser, error } = await supabase
            .from('users')
            .update(updateData)
            .eq('id', req.user.id)
            .select('calls_enabled, notification_sound')
            .single();

        if (error) return res.status(500).json({ error: 'Failed to update settings' });

        res.json(updatedUser);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /check/:userId
router.get('/check/:userId', async (req, res) => {
    const targetId = req.params.userId;
    const [user_a_id, user_b_id] = friendshipKey(req.user.id, targetId);

    try {
        const { data: friendship, error: friendError } = await supabase
            .from('friendships')
            .select('id')
            .eq('user_a_id', user_a_id)
            .eq('user_b_id', user_b_id)
            .maybeSingle();

        if (friendError && friendError.code !== 'PGRST116') {
            console.error(friendError);
        }

        if (friendship) {
            return res.json({ friends: true, pendingRequest: null });
        }

        const { data: requests, error: reqError } = await supabase
            .from('friend_requests')
            .select('*')
            .eq('status', 'pending')
            .or(`and(from_user_id.eq.${req.user.id},to_user_id.eq.${targetId}),and(from_user_id.eq.${targetId},to_user_id.eq.${req.user.id})`);

        if (reqError) return res.status(500).json({ error: 'Database error' });

        const pendingRequest = (requests && requests.length > 0) ? requests[0] : null;

        res.json({ friends: false, pendingRequest });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = (io) => { _io = io; return router; };
