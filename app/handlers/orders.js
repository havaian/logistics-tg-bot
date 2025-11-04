const Order = require('../models/order');
const User = require('../models/user');
const { t } = require('../utils/i18nHelper');
const { logAction, logWarn } = require('../logger');
const {
    getBackButton,
    getConfirmationKeyboard,
    formatOrderSummary,
    getPaginationKeyboard
} = require('./common');

// Session storage for order creation process
const orderSessions = new Map();

/**
 * Start order creation process
 */
const startOrderCreation = async (ctx) => {
    try {
        const user = ctx.user;

        if (!user.isClient()) {
            await ctx.reply(t(ctx, 'errors.access_denied'));
            return;
        }

        // Initialize order session
        const sessionId = ctx.from.id;
        orderSessions.set(sessionId, {
            step: 'from',
            data: {
                clientId: user._id
            }
        });

        await ctx.reply(
            t(ctx, 'orders.create_title') + '\n\n' + t(ctx, 'orders.enter_from'),
            getBackButton(ctx, 'menu:main')
        );

        logAction('order_creation_started', {
            userId: user._id,
            userRole: user.profile.role
        });
    } catch (error) {
        await ctx.reply(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Handle order creation steps
 */
const handleOrderCreationStep = async (ctx) => {
    try {
        const sessionId = ctx.from.id;
        const session = orderSessions.get(sessionId);

        if (!session) {
            return false; // No active session
        }

        const messageText = ctx.message.text?.trim();

        // Handle skip button
        if (messageText === t(ctx, 'orders.skip')) {
            return await handleSkipStep(ctx, session);
        }

        switch (session.step) {
            case 'from':
                return await handleFromStep(ctx, session, messageText);
            case 'to':
                return await handleToStep(ctx, session, messageText);
            case 'date':
                return await handleDateStep(ctx, session, messageText);
            case 'price':
                return await handlePriceStep(ctx, session, messageText);
            case 'description':
                return await handleDescriptionStep(ctx, session, messageText);
            case 'weight':
                return await handleWeightStep(ctx, session, messageText);
            case 'contact_name':
                return await handleContactNameStep(ctx, session, messageText);
            default:
                return false;
        }
    } catch (error) {
        await ctx.reply(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Handle 'from' location step
 */
const handleFromStep = async (ctx, session, messageText) => {
    if (!messageText || messageText.length < 2) {
        await ctx.reply(t(ctx, 'errors.invalid_input'));
        return true;
    }

    session.data.from = messageText;
    session.step = 'to';
    orderSessions.set(ctx.from.id, session);

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: t(ctx, 'orders.skip'), callback_data: 'order:skip' }],
                [{ text: t(ctx, 'buttons.cancel'), callback_data: 'order:cancel' }]
            ]
        }
    };

    await ctx.reply(t(ctx, 'orders.enter_to'), keyboard);
    return true;
};

/**
 * Handle 'to' location step
 */
const handleToStep = async (ctx, session, messageText) => {
    if (messageText && messageText.length >= 2) {
        session.data.to = messageText;
    }

    session.step = 'date';
    orderSessions.set(ctx.from.id, session);

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: t(ctx, 'orders.skip'), callback_data: 'order:skip' }],
                [{ text: t(ctx, 'buttons.cancel'), callback_data: 'order:cancel' }]
            ]
        }
    };

    await ctx.reply(t(ctx, 'orders.enter_date'), keyboard);
    return true;
};

/**
 * Handle date step
 */
const handleDateStep = async (ctx, session, messageText) => {
    if (messageText && messageText.length >= 8) {
        // Try to parse date
        const dateRegex = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;
        const match = messageText.match(dateRegex);

        if (match) {
            const [_, day, month, year] = match;
            const date = new Date(year, month - 1, day);

            if (date > new Date()) {
                session.data.scheduledDate = date;
            }
        }
    }

    session.step = 'price';
    orderSessions.set(ctx.from.id, session);

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: t(ctx, 'orders.skip'), callback_data: 'order:skip' }],
                [{ text: t(ctx, 'buttons.cancel'), callback_data: 'order:cancel' }]
            ]
        }
    };

    await ctx.reply(t(ctx, 'orders.enter_price'), keyboard);
    return true;
};

/**
 * Handle price step
 */
const handlePriceStep = async (ctx, session, messageText) => {
    if (messageText) {
        const price = parseInt(messageText.replace(/[^\d]/g, ''));
        if (!isNaN(price) && price > 0) {
            session.data.price = price;
        }
    }

    session.step = 'description';
    orderSessions.set(ctx.from.id, session);

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: t(ctx, 'orders.skip'), callback_data: 'order:skip' }],
                [{ text: t(ctx, 'buttons.cancel'), callback_data: 'order:cancel' }]
            ]
        }
    };

    await ctx.reply(t(ctx, 'orders.enter_description'), keyboard);
    return true;
};

/**
 * Handle description step
 */
const handleDescriptionStep = async (ctx, session, messageText) => {
    if (messageText && messageText.length >= 5) {
        session.data.description = messageText;
    }

    session.step = 'weight';
    orderSessions.set(ctx.from.id, session);

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: t(ctx, 'orders.skip'), callback_data: 'order:skip' }],
                [{ text: t(ctx, 'buttons.cancel'), callback_data: 'order:cancel' }]
            ]
        }
    };

    await ctx.reply(t(ctx, 'orders.enter_weight'), keyboard);
    return true;
};

/**
 * Handle weight step
 */
const handleWeightStep = async (ctx, session, messageText) => {
    if (messageText && messageText.length >= 2) {
        session.data.weight = messageText;
    }

    session.step = 'contact_name';
    orderSessions.set(ctx.from.id, session);

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: t(ctx, 'orders.skip'), callback_data: 'order:skip' }],
                [{ text: t(ctx, 'buttons.cancel'), callback_data: 'order:cancel' }]
            ]
        }
    };

    await ctx.reply(t(ctx, 'orders.enter_contact_name'), keyboard);
    return true;
};

/**
 * Handle contact name step and show confirmation
 */
const handleContactNameStep = async (ctx, session, messageText) => {
    if (messageText && messageText.length >= 2) {
        session.data.contactName = messageText;
    }

    // Show order confirmation
    await showOrderConfirmation(ctx, session);
    return true;
};

/**
 * Handle skip step
 */
const handleSkipStep = async (ctx, session) => {
    switch (session.step) {
        case 'to':
            return await handleToStep(ctx, session, null);
        case 'date':
            return await handleDateStep(ctx, session, null);
        case 'price':
            return await handlePriceStep(ctx, session, null);
        case 'description':
            return await handleDescriptionStep(ctx, session, null);
        case 'weight':
            return await handleWeightStep(ctx, session, null);
        case 'contact_name':
            return await handleContactNameStep(ctx, session, null);
        default:
            return false;
    }
};

/**
 * Show order confirmation
 */
const showOrderConfirmation = async (ctx, session) => {
    const data = session.data;
    const user = ctx.user;

    // Create order summary
    const orderSummary = [
        `📍 Откуда: ${data.from}`,
        `📍 Куда: ${data.to || 'По договоренности'}`,
        `📅 Дата: ${data.scheduledDate ? data.scheduledDate.toLocaleDateString('ru-RU') : 'По договоренности'}`,
        `💰 Цена: ${data.price ? data.price + ' сум' : 'По договоренности'}`,
        `📝 Описание: ${data.description || 'Не указано'}`,
        `⚖️ Вес: ${data.weight || 'Не указан'}`,
        `👤 Контакт: ${data.contactName || user.profile.fullName}`,
        `📱 Телефон: ${user.profile.phoneNumber || 'Из профиля'}`
    ].join('\n');

    session.step = 'confirmation';
    orderSessions.set(ctx.from.id, session);

    await ctx.reply(
        t(ctx, 'orders.confirm_order', { orderSummary }),
        getConfirmationKeyboard(ctx, 'order:confirm', 'order:cancel')
    );
};

/**
 * Confirm and create order
 */
const confirmOrder = async (ctx) => {
    try {
        const sessionId = ctx.from.id;
        const session = orderSessions.get(sessionId);
        const user = ctx.user;

        if (!session || session.step !== 'confirmation') {
            await ctx.answerCbQuery(t(ctx, 'errors.general'));
            return;
        }

        // Create order
        const orderData = {
            clientId: user._id,
            cargo: {
                from: session.data.from,
                to: session.data.to,
                scheduledDate: session.data.scheduledDate,
                description: session.data.description,
                price: session.data.price,
                weight: session.data.weight
            },
            contactInfo: {
                phoneNumber: user.profile.phoneNumber,
                contactName: session.data.contactName || user.profile.fullName
            }
        };

        const order = new Order(orderData);
        await order.save();

        // Update user's active orders count
        user.activeOrders += 1;
        await user.save();

        // Clear session
        orderSessions.delete(sessionId);

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            t(ctx, 'orders.order_created', { orderId: order._id.toString().slice(-6) })
        );

        // Post to group (if enabled)
        await postOrderToGroup(order, ctx);

        // Show main menu
        const { getMainMenuKeyboard } = require('./common');
        setTimeout(async () => {
            await ctx.reply(
                t(ctx, 'menu.main_client'),
                getMainMenuKeyboard(ctx, user)
            );
        }, 2000);

        logAction('order_created', {
            userId: user._id,
            orderId: order._id,
            from: order.cargo.from,
            to: order.cargo.to,
            price: order.cargo.price
        });

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Cancel order creation
 */
const cancelOrderCreation = async (ctx) => {
    try {
        const sessionId = ctx.from.id;
        orderSessions.delete(sessionId);

        await ctx.answerCbQuery();
        await ctx.editMessageText(t(ctx, 'buttons.cancel'));

        // Show main menu
        const { getMainMenuKeyboard } = require('./common');
        setTimeout(async () => {
            await ctx.reply(
                t(ctx, ctx.user.isDriver() ? 'menu.main_driver' : 'menu.main_client'),
                getMainMenuKeyboard(ctx, ctx.user)
            );
        }, 1000);
    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Find orders for drivers
 */
const findOrdersForDriver = async (ctx, page = 1) => {
    try {
        const user = ctx.user;
        const limit = 5;
        const skip = (page - 1) * limit;

        if (!user.isDriver()) {
            await ctx.reply(t(ctx, 'errors.access_denied'));
            return;
        }

        const location = user.driverInfo.currentLocation;
        let orders;

        if (location) {
            orders = await Order.findOrdersByLocation(location)
                .skip(skip)
                .limit(limit);
        } else {
            orders = await Order.findActiveOrders()
                .skip(skip)
                .limit(limit);
        }

        if (orders.length === 0) {
            await ctx.reply(
                t(ctx, 'orders.no_orders_found'),
                getBackButton(ctx, 'menu:main')
            );
            return;
        }

        // Show orders with pagination
        let messageText = `🔍 Доступные заказы (страница ${page}):\n\n`;

        orders.forEach((order, index) => {
            const orderNum = skip + index + 1;
            const summary = `${orderNum}. ${order.summary}\n`;
            const details = `   📅 ${order.cargo.scheduledDate ? new Date(order.cargo.scheduledDate).toLocaleDateString() : 'Договорная'}\n`;
            const contact = `   📱 ${order.contactInfo.contactName || 'Заказчик'}\n\n`;

            messageText += summary + details + contact;
        });

        // Create keyboard with order buttons
        const keyboard = [];
        orders.forEach((order, index) => {
            const orderNum = skip + index + 1;
            keyboard.push([{
                text: `📦 Заказ ${orderNum}`,
                callback_data: `order:view:${order._id}`
            }]);
        });

        // Add pagination if needed
        const totalOrders = await Order.countDocuments({ status: 'active' });
        const totalPages = Math.ceil(totalOrders / limit);

        if (totalPages > 1) {
            const paginationRow = [];
            if (page > 1) {
                paginationRow.push({
                    text: '◀️ Предыдущая',
                    callback_data: `driver:find_orders:${page - 1}`
                });
            }
            if (page < totalPages) {
                paginationRow.push({
                    text: 'Следующая ▶️',
                    callback_data: `driver:find_orders:${page + 1}`
                });
            }
            if (paginationRow.length > 0) {
                keyboard.push(paginationRow);
            }
        }

        keyboard.push([{ text: t(ctx, 'buttons.back'), callback_data: 'menu:main' }]);

        await ctx.reply(messageText, { reply_markup: { inline_keyboard: keyboard } });

    } catch (error) {
        await ctx.reply(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * View specific order details
 */
const viewOrderDetails = async (ctx, orderId) => {
    try {
        const order = await Order.findById(orderId).populate('clientId', 'profile');

        if (!order) {
            await ctx.answerCbQuery(t(ctx, 'errors.order_not_found'));
            return;
        }

        const orderDetails = formatOrderSummary(order, ctx);

        const keyboard = [];

        // Add interest button for drivers
        if (ctx.user.isDriver() && order.canBeMatched()) {
            const alreadyInterested = order.interestedDrivers.some(
                d => d.driverId.toString() === ctx.user._id.toString()
            );

            if (!alreadyInterested && ctx.user.canTakeMoreOrders()) {
                keyboard.push([{
                    text: t(ctx, 'orders.interested_button'),
                    callback_data: `order:interest:${orderId}`
                }]);
            } else if (alreadyInterested) {
                keyboard.push([{
                    text: t(ctx, 'orders.already_interested'),
                    callback_data: 'noop'
                }]);
            } else {
                keyboard.push([{
                    text: t(ctx, 'orders.cannot_take_more'),
                    callback_data: 'noop'
                }]);
            }
        }

        keyboard.push([{ text: t(ctx, 'buttons.back'), callback_data: 'driver:find_orders' }]);

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            orderDetails,
            { reply_markup: { inline_keyboard: keyboard } }
        );

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Show driver interest in order
 */
const showInterestInOrder = async (ctx, orderId) => {
    try {
        const order = await Order.findById(orderId).populate('clientId', 'profile');
        const user = ctx.user;

        if (!order || !order.canBeMatched()) {
            await ctx.answerCbQuery(t(ctx, 'errors.order_not_found'));
            return;
        }

        if (!user.canTakeMoreOrders()) {
            await ctx.answerCbQuery(t(ctx, 'orders.cannot_take_more'));
            return;
        }

        // Add driver to interested list
        await order.addInterestedDriver(user._id);

        await ctx.answerCbQuery(t(ctx, 'orders.interest_sent'));

        // Notify client about interested driver
        const clientId = order.clientId.telegramId;
        const notification = t(ctx, 'notifications.driver_interested', {
            driverName: user.profile.fullName,
            rating: user.reputation.rating.toFixed(1),
            phone: user.profile.phoneNumber || 'Не указан'
        });

        // Send notification to client (you'll need to implement this)
        // await ctx.telegram.sendMessage(clientId, notification);

        logAction('driver_showed_interest', {
            driverId: user._id,
            orderId: order._id,
            clientId: order.clientId._id
        });

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Post order to Telegram group (placeholder)
 */
const postOrderToGroup = async (order, ctx) => {
    try {
        // This will be implemented when group management is ready
        const { postToGroups } = require('./groups');
        await postToGroups(order, ctx);
    } catch (error) {
        // Silent fail - groups not yet implemented
        logWarn('Group posting not yet implemented');
    }
};

module.exports = {
    startOrderCreation,
    handleOrderCreationStep,
    confirmOrder,
    cancelOrderCreation,
    findOrdersForDriver,
    viewOrderDetails,
    showInterestInOrder
};