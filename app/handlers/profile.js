const User = require('../models/user');
const Order = require('../models/order');
const { t } = require('../utils/i18nHelper');
const {
    getBackButton,
    formatUserInfo,
    getMainMenuKeyboard
} = require('./common');

/**
 * Show user profile
 */
const showProfile = async (ctx) => {
    try {
        const user = ctx.user;

        const profileInfo = formatUserInfo(user, ctx);

        const keyboard = [
            [{ text: t(ctx, 'profile.edit_location'), callback_data: 'profile:edit_location' }]
        ];

        // Add role-specific options
        if (user.isDriver()) {
            keyboard.push([
                { text: '🚗 Изменить транспорт', callback_data: 'profile:edit_vehicle' }
            ]);
        }

        keyboard.push([{ text: t(ctx, 'buttons.back'), callback_data: 'menu:main' }]);

        await ctx.reply(
            t(ctx, 'profile.title') + '\n\n' + profileInfo,
            { reply_markup: { inline_keyboard: keyboard } }
        );

        global.logger.logAction('profile_viewed', {
            userId: user._id,
            role: user.profile.role
        });

    } catch (error) {
        await ctx.reply(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Show my orders
 */
const showMyOrders = async (ctx, page = 1) => {
    try {
        const user = ctx.user;
        const limit = 5;
        const skip = (page - 1) * limit;

        const orders = await Order.findUserOrders(user._id)
            .skip(skip)
            .limit(limit);

        if (orders.length === 0) {
            await ctx.reply(
                t(ctx, 'orders.no_orders'),
                getBackButton(ctx, 'menu:main')
            );
            return;
        }

        let messageText = `📋 Мои заказы (страница ${page}):\n\n`;

        orders.forEach((order, index) => {
            const orderNum = skip + index + 1;
            const isClient = order.clientId._id.toString() === user._id.toString();
            const role = isClient ? '📦 Заказчик' : '🚛 Водитель';
            const status = t(ctx, `status.${order.status}`);

            messageText += `${orderNum}. ${order.summary}\n`;
            messageText += `   ${role} | ${status}\n`;
            messageText += `   📅 ${new Date(order.createdAt).toLocaleDateString('ru-RU')}\n\n`;
        });

        // Create keyboard with order buttons
        const keyboard = [];
        orders.forEach((order, index) => {
            const orderNum = skip + index + 1;
            keyboard.push([{
                text: `📋 Заказ ${orderNum}`,
                callback_data: `myorder:view:${order._id}`
            }]);
        });

        // Add pagination if needed
        const totalOrders = await Order.countDocuments({
            $or: [{ clientId: user._id }, { driverId: user._id }]
        });
        const totalPages = Math.ceil(totalOrders / limit);

        if (totalPages > 1) {
            const paginationRow = [];
            if (page > 1) {
                paginationRow.push({
                    text: '◀️ Предыдущая',
                    callback_data: `myorders:${page - 1}`
                });
            }
            if (page < totalPages) {
                paginationRow.push({
                    text: 'Следующая ▶️',
                    callback_data: `myorders:${page + 1}`
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
 * View my specific order
 */
const viewMyOrder = async (ctx, orderId) => {
    try {
        const user = ctx.user;
        const order = await Order.findById(orderId)
            .populate('clientId', 'profile')
            .populate('driverId', 'profile');

        if (!order) {
            await ctx.answerCbQuery(t(ctx, 'errors.order_not_found'));
            return;
        }

        // Check if user has access to this order
        const hasAccess = order.clientId._id.toString() === user._id.toString() ||
            (order.driverId && order.driverId._id.toString() === user._id.toString());

        if (!hasAccess) {
            await ctx.answerCbQuery(t(ctx, 'errors.access_denied'));
            return;
        }

        const isClient = order.clientId._id.toString() === user._id.toString();
        const { formatOrderSummary } = require('./common');
        let orderDetails = formatOrderSummary(order, ctx);

        // Add role-specific information
        if (isClient && order.driverId) {
            orderDetails += `\n\n🚛 Водитель: ${order.driverId.profile.fullName}`;
            if (order.driverId.profile.phoneNumber) {
                orderDetails += `\n📱 Телефон: ${order.driverId.profile.phoneNumber}`;
            }
        } else if (!isClient && order.clientId) {
            orderDetails += `\n\n📦 Заказчик: ${order.clientId.profile.fullName}`;
            if (order.contactInfo.phoneNumber) {
                orderDetails += `\n📱 Телефон: ${order.contactInfo.phoneNumber}`;
            }
        }

        // Show interested drivers for clients
        if (isClient && order.interestedDrivers.length > 0 && order.status === 'active') {
            orderDetails += `\n\n👥 Откликнулось водителей: ${order.interestedDrivers.length}`;
        }

        const keyboard = [];

        // Add action buttons based on status and role
        if (order.status === 'active' && isClient && order.interestedDrivers.length > 0) {
            keyboard.push([{
                text: '👥 Показать водителей',
                callback_data: `myorder:drivers:${orderId}`
            }]);
        }

        if (order.status === 'matched' || order.status === 'in_progress') {
            keyboard.push([{
                text: 'Завершить заказ',
                callback_data: `myorder:complete:${orderId}`
            }]);
        }

        if (order.status === 'active' && isClient) {
            keyboard.push([{
                text: 'Отменить заказ',
                callback_data: `myorder:cancel:${orderId}`
            }]);
        }

        keyboard.push([{ text: t(ctx, 'buttons.back'), callback_data: 'myorders:1' }]);

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
 * Show interested drivers for a client's order
 */
const showInterestedDrivers = async (ctx, orderId) => {
    try {
        const user = ctx.user;
        const order = await Order.findById(orderId)
            .populate('clientId', 'profile')
            .populate('interestedDrivers.driverId', 'profile reputation driverInfo');

        if (!order || order.clientId._id.toString() !== user._id.toString()) {
            await ctx.answerCbQuery(t(ctx, 'errors.access_denied'));
            return;
        }

        if (order.interestedDrivers.length === 0) {
            await ctx.answerCbQuery('Пока нет откликов');
            return;
        }

        let messageText = `👥 Заинтересованные водители:\n\n`;

        const keyboard = [];

        order.interestedDrivers.forEach((interested, index) => {
            const driver = interested.driverId;
            const driverNum = index + 1;

            messageText += `${driverNum}. 🚛 ${driver.profile.fullName}\n`;
            messageText += `   ⭐ Рейтинг: ${driver.reputation.rating.toFixed(1)}/5\n`;
            messageText += `   Сделок: ${driver.reputation.completedDeals}\n`;
            if (driver.driverInfo.vehicleModel) {
                messageText += `   🚗 ${driver.driverInfo.vehicleModel}\n`;
            }
            if (driver.profile.phoneNumber) {
                messageText += `   📱 ${driver.profile.phoneNumber}\n`;
            }
            messageText += `\n`;

            keyboard.push([{
                text: `Выбрать водителя ${driverNum}`,
                callback_data: `myorder:select:${orderId}:${driver._id}`
            }]);
        });

        keyboard.push([{ text: t(ctx, 'buttons.back'), callback_data: `myorder:view:${orderId}` }]);

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            messageText,
            { reply_markup: { inline_keyboard: keyboard } }
        );

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Select driver for order
 */
const selectDriverForOrder = async (ctx, orderId, driverId) => {
    try {
        const user = ctx.user;
        const order = await Order.findById(orderId);
        const driver = await User.findById(driverId);

        if (!order || !driver) {
            await ctx.answerCbQuery(t(ctx, 'errors.order_not_found'));
            return;
        }

        if (order.clientId.toString() !== user._id.toString()) {
            await ctx.answerCbQuery(t(ctx, 'errors.access_denied'));
            return;
        }

        if (!driver.canTakeMoreOrders()) {
            await ctx.answerCbQuery('Водитель не может взять больше заказов');
            return;
        }

        // Assign driver to order
        await order.assignDriver(driverId);

        // Update driver's active orders count
        driver.activeOrders += 1;
        await driver.save();

        await ctx.answerCbQuery('Водитель назначен!');

        // Send notification to driver
        try {
            await ctx.telegram.sendMessage(
                driver.telegramId,
                `Вы назначены на заказ!\n\n${order.summary}\n\nСвяжитесь с заказчиком: ${user.profile.phoneNumber || 'См. профиль'}`
            );
        } catch (error) {
            global.logger.logWarn('Failed to notify driver:', ctx, error.message);
        }

        // Update the message
        await viewMyOrder(ctx, orderId);

        global.logger.logAction('driver_selected', {
            orderId: order._id,
            driverId: driver._id,
            clientId: user._id
        });

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Complete order
 */
const completeOrder = async (ctx, orderId) => {
    try {
        const user = ctx.user;
        const order = await Order.findById(orderId)
            .populate('clientId', 'profile')
            .populate('driverId', 'profile');

        if (!order) {
            await ctx.answerCbQuery(t(ctx, 'errors.order_not_found'));
            return;
        }

        const isClient = order.clientId._id.toString() === user._id.toString();
        const isDriver = order.driverId && order.driverId._id.toString() === user._id.toString();

        if (!isClient && !isDriver) {
            await ctx.answerCbQuery(t(ctx, 'errors.access_denied'));
            return;
        }

        // Mark completion by the user
        if (isClient) {
            order.dealCompletedBy.client = true;
        } else if (isDriver) {
            order.dealCompletedBy.driver = true;
        }

        // If both parties confirmed, complete the order
        if (order.dealCompletedBy.client && order.dealCompletedBy.driver) {
            await order.markCompleted();

            // Update statistics
            if (order.driverId) {
                const driver = await User.findById(order.driverId._id);
                driver.reputation.completedDeals += 1;
                driver.activeOrders = Math.max(0, driver.activeOrders - 1);
                await driver.save();
            }

            const client = await User.findById(order.clientId._id);
            client.activeOrders = Math.max(0, client.activeOrders - 1);
            await client.save();

            await ctx.answerCbQuery('Заказ завершен!');

            // TODO: Show review interface

        } else {
            await order.save();
            const waitingFor = isClient ? 'водителя' : 'заказчика';
            await ctx.answerCbQuery(`Отмечено! Ожидаем подтверждения от ${waitingFor}`);

            // Notify the other party
            const otherPartyId = isClient ? order.driverId.telegramId : order.clientId.telegramId;
            try {
                await ctx.telegram.sendMessage(
                    otherPartyId,
                    `⏰ Напоминание о заказе #${order._id.toString().slice(-6)}\n\nВторая сторона подтвердила завершение сделки. Пожалуйста, также подтвердите завершение в своих заказах.`
                );
            } catch (error) {
                global.logger.logWarn('Failed to notify other party:', ctx, error.message);
            }
        }

        // Update the message
        await viewMyOrder(ctx, orderId);

        global.logger.logAction('order_completion_marked', {
            orderId: order._id,
            userId: user._id,
            role: isClient ? 'client' : 'driver',
            fullyCompleted: order.dealCompletedBy.client && order.dealCompletedBy.driver
        });

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Cancel order
 */
const cancelOrder = async (ctx, orderId) => {
    try {
        const user = ctx.user;
        const order = await Order.findById(orderId);

        if (!order) {
            await ctx.answerCbQuery(t(ctx, 'errors.order_not_found'));
            return;
        }

        if (order.clientId.toString() !== user._id.toString()) {
            await ctx.answerCbQuery(t(ctx, 'errors.access_denied'));
            return;
        }

        if (order.status !== 'active') {
            await ctx.answerCbQuery('Можно отменить только активные заказы');
            return;
        }

        order.status = 'cancelled';
        await order.save();

        // Update user's active orders count
        user.activeOrders = Math.max(0, user.activeOrders - 1);
        await user.save();

        await ctx.answerCbQuery('Заказ отменен');

        // Update the message
        await viewMyOrder(ctx, orderId);

        global.logger.logAction('order_cancelled', {
            orderId: order._id,
            clientId: user._id
        });

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Start location editing
 */
const startLocationEdit = async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            '📍 Введите ваше новое местоположение (город):',
            getBackButton(ctx, 'profile:view')
        );

        // Set user state for location editing
        ctx.user.tempState = 'editing_location';
        await ctx.user.save();

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Handle location update
 */
const handleLocationUpdate = async (ctx) => {
    try {
        const user = ctx.user;
        const newLocation = ctx.message.text.trim();

        if (newLocation.length < 2) {
            await ctx.reply('Слишком короткое название. Попробуйте еще раз.');
            return true;
        }

        if (user.isDriver()) {
            user.driverInfo.currentLocation = newLocation;
        }

        user.tempState = null;
        await user.save();

        await ctx.reply('Местоположение обновлено!');

        // Show updated profile
        setTimeout(async () => {
            await showProfile(ctx);
        }, 1000);

        global.logger.logAction('location_updated', {
            userId: user._id,
            newLocation: newLocation
        });

        return true;
    } catch (error) {
        await ctx.reply(t(ctx, 'errors.general'));
        throw error;
    }
};

module.exports = {
    showProfile,
    showMyOrders,
    viewMyOrder,
    showInterestedDrivers,
    selectDriverForOrder,
    completeOrder,
    cancelOrder,
    startLocationEdit,
    handleLocationUpdate
};