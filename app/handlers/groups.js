const { t } = require('../utils/i18nHelper');
const { logAction } = require('../logger');

/**
 * Configuration for Telegram groups where orders should be posted
 * Add your group chat IDs here when ready
 */
const LOGISTICS_GROUPS = [
    // {
    //   id: -1001234567890, // Example group ID
    //   name: 'Логистика Ташкент',
    //   region: 'ташкент',
    //   active: true
    // },
    // {
    //   id: -1001234567891,
    //   name: 'Грузоперевозки Самарканд',
    //   region: 'самарканд',
    //   active: true
    // }
];

/**
 * Get active groups for posting
 */
const getActiveGroups = () => {
    return LOGISTICS_GROUPS.filter(group => group.active);
};

/**
 * Get groups by region
 */
const getGroupsByRegion = (region) => {
    if (!region) return getActiveGroups();

    const searchRegion = region.toLowerCase();
    return LOGISTICS_GROUPS.filter(group =>
        group.active &&
        group.region.toLowerCase().includes(searchRegion)
    );
};

/**
 * Format order message for group posting
 */
const formatOrderForGroup = (order, ctx) => {
    const from = order.cargo.from;
    const to = order.cargo.to || 'По договоренности';
    const date = order.cargo.scheduledDate
        ? new Date(order.cargo.scheduledDate).toLocaleDateString('ru-RU')
        : 'По договоренности';
    const price = order.cargo.price ? `${order.cargo.price} сум` : 'По договоренности';
    const description = order.cargo.description || '';
    const weight = order.cargo.weight || '';
    const contact = order.contactInfo.contactName || 'Заказчик';
    const phone = order.contactInfo.phoneNumber || '';

    let message = `🚛 НОВЫЙ ЗАКАЗ\n\n`;
    message += `📍 Откуда: ${from}\n`;
    message += `📍 Куда: ${to}\n`;
    message += `📅 Дата: ${date}\n`;
    message += `💰 Цена: ${price}\n`;

    if (description) {
        message += `📝 Описание: ${description}\n`;
    }

    if (weight) {
        message += `⚖️ Вес: ${weight}\n`;
    }

    message += `\n👤 Контакт: ${contact}\n`;

    if (phone) {
        message += `📱 Телефон: ${phone}\n`;
    }

    message += `\n🆔 Заказ #${order._id.toString().slice(-6)}`;

    return message;
};

/**
 * Create inline keyboard for group message
 */
const createGroupKeyboard = (orderId) => {
    return {
        inline_keyboard: [
            [
                {
                    text: '✋ Откликнуться',
                    callback_data: `group:interest:${orderId}`
                },
                {
                    text: '📱 Связаться',
                    callback_data: `group:contact:${orderId}`
                }
            ],
            [
                {
                    text: '📋 Подробнее',
                    url: `https://t.me/${process.env.BOT_USERNAME}?start=order_${orderId}`
                }
            ]
        ]
    };
};

/**
 * Post order to relevant groups
 */
const postToGroups = async (order, ctx) => {
    try {
        if (LOGISTICS_GROUPS.length === 0) {
            logAction('group_posting_skipped', {
                orderId: order._id,
                reason: 'no_groups_configured'
            });
            return;
        }

        const orderLocation = order.cargo.from.toLowerCase();
        const relevantGroups = getGroupsByRegion(orderLocation);

        if (relevantGroups.length === 0) {
            // Fallback to all active groups if no regional match
            relevantGroups.push(...getActiveGroups());
        }

        const message = formatOrderForGroup(order, ctx);
        const keyboard = createGroupKeyboard(order._id);

        const postingResults = [];

        for (const group of relevantGroups) {
            try {
                const sentMessage = await ctx.telegram.sendMessage(
                    group.id,
                    message,
                    { reply_markup: keyboard }
                );

                // Store the message ID for potential updates
                if (!order.groupMessageId) {
                    order.groupMessageId = sentMessage.message_id;
                    order.publishedToGroup = true;
                    await order.save();
                }

                postingResults.push({
                    groupId: group.id,
                    groupName: group.name,
                    success: true,
                    messageId: sentMessage.message_id
                });

                logAction('order_posted_to_group', {
                    orderId: order._id,
                    groupId: group.id,
                    groupName: group.name,
                    messageId: sentMessage.message_id
                });

            } catch (error) {
                postingResults.push({
                    groupId: group.id,
                    groupName: group.name,
                    success: false,
                    error: error.message
                });

                logAction('group_posting_failed', {
                    orderId: order._id,
                    groupId: group.id,
                    groupName: group.name,
                    error: error.message
                });
            }
        }

        return postingResults;

    } catch (error) {
        logAction('group_posting_error', {
            orderId: order._id,
            error: error.message
        });
        throw error;
    }
};

/**
 * Handle group callback queries
 */
const handleGroupInterest = async (ctx) => {
    try {
        const orderId = ctx.callbackQuery.data.split(':')[2];
        const user = ctx.from;

        // Direct user to bot for full registration/interaction
        const botUsername = process.env.BOT_USERNAME || 'your_bot_username';
        const deepLink = `https://t.me/${botUsername}?start=order_${orderId}`;

        await ctx.answerCbQuery(
            'Для отклика на заказ перейдите в личные сообщения с ботом',
            { url: deepLink }
        );

        logAction('group_interest_redirected', {
            orderId,
            userId: user.id,
            username: user.username,
            groupId: ctx.chat.id
        });

    } catch (error) {
        await ctx.answerCbQuery('Произошла ошибка. Попробуйте позже.');
        throw error;
    }
};

/**
 * Handle group contact requests
 */
const handleGroupContact = async (ctx) => {
    try {
        const orderId = ctx.callbackQuery.data.split(':')[2];
        const Order = require('../models/order');

        const order = await Order.findById(orderId).populate('clientId', 'profile');

        if (!order) {
            await ctx.answerCbQuery('Заказ не найден');
            return;
        }

        const contactInfo = `👤 ${order.contactInfo.contactName || order.clientId.profile.fullName}\n📱 ${order.contactInfo.phoneNumber || 'Не указан'}`;

        await ctx.answerCbQuery(contactInfo, { show_alert: true });

        logAction('group_contact_shown', {
            orderId,
            userId: ctx.from.id,
            groupId: ctx.chat.id
        });

    } catch (error) {
        await ctx.answerCbQuery('Произошла ошибка при получении контактов');
        throw error;
    }
};

/**
 * Update order status in groups
 */
const updateOrderInGroups = async (order, newStatus, ctx) => {
    try {
        if (!order.publishedToGroup || !order.groupMessageId) {
            return;
        }

        const statusMessage = getStatusUpdateMessage(order, newStatus, ctx);

        // In a real implementation, you would update the original messages
        // For now, we'll just log the update
        logAction('order_status_updated_in_groups', {
            orderId: order._id,
            newStatus,
            groupMessageId: order.groupMessageId
        });

    } catch (error) {
        logAction('group_update_failed', {
            orderId: order._id,
            error: error.message
        });
    }
};

/**
 * Get status update message
 */
const getStatusUpdateMessage = (order, status, ctx) => {
    const statusEmoji = {
        'matched': '✅ ЗАКАЗ ПРИНЯТ',
        'in_progress': '🚛 В ПУТИ',
        'completed': '✅ ВЫПОЛНЕН',
        'cancelled': '❌ ОТМЕНЕН'
    };

    return statusEmoji[status] || '📋 ОБНОВЛЕН';
};

/**
 * Add new group to configuration
 */
const addGroup = (groupId, groupName, region = '') => {
    const existingGroup = LOGISTICS_GROUPS.find(g => g.id === groupId);

    if (existingGroup) {
        existingGroup.active = true;
        existingGroup.name = groupName;
        existingGroup.region = region.toLowerCase();
    } else {
        LOGISTICS_GROUPS.push({
            id: groupId,
            name: groupName,
            region: region.toLowerCase(),
            active: true
        });
    }

    logAction('group_added', {
        groupId,
        groupName,
        region
    });
};

/**
 * Remove group from configuration
 */
const removeGroup = (groupId) => {
    const groupIndex = LOGISTICS_GROUPS.findIndex(g => g.id === groupId);

    if (groupIndex !== -1) {
        LOGISTICS_GROUPS[groupIndex].active = false;

        logAction('group_removed', {
            groupId,
            groupName: LOGISTICS_GROUPS[groupIndex].name
        });
    }
};

/**
 * Get groups list for admin
 */
const getGroupsList = () => {
    return LOGISTICS_GROUPS.map(group => ({
        id: group.id,
        name: group.name,
        region: group.region,
        active: group.active
    }));
};

module.exports = {
    getActiveGroups,
    getGroupsByRegion,
    postToGroups,
    handleGroupInterest,
    handleGroupContact,
    updateOrderInGroups,
    addGroup,
    removeGroup,
    getGroupsList
};