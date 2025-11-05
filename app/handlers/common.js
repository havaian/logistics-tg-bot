const User = require('../models/user');
/**
 * Get or create user (simplified version)
 */
const getOrCreateUser = async (ctx) => {
    try {
        let user = await User.findByTelegramId(ctx.from.id);

        if (!user) {
            user = new User({
                telegramId: ctx.from.id,
                profile: {
                    firstName: ctx.from.first_name || '',
                    lastName: ctx.from.last_name || ''
                },
                language: ctx.locale || 'ru'
            });
            await user.save();
        }

        return user;
    } catch (error) {
        throw new Error('Failed to get or create user: ' + error.message);
    }
};

/**
 * Check if chat is a group chat
 */
const isGroupChat = (ctx) => {
    return ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup');
};

/**
 * Check if user is a student (legacy function, can be removed)
 */
const isStudent = (user) => {
    return false; // Not applicable to logistics bot
};

/**
 * Get main menu keyboard for drivers
 */
const getDriverMenuKeyboard = (ctx) => {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: global.i18n.t(ctx, 'menu.find_orders'), callback_data: 'driver:find_orders' },
                    { text: global.i18n.t(ctx, 'menu.my_orders'), callback_data: 'driver:my_orders' }
                ],
                [
                    { text: global.i18n.t(ctx, 'menu.my_profile'), callback_data: 'profile:view' },
                    { text: global.i18n.t(ctx, 'menu.settings'), callback_data: 'settings:main' }
                ],
                [
                    { text: global.i18n.t(ctx, 'buttons.help'), callback_data: 'help:main' }
                ]
            ]
        }
    };
};

/**
 * Get main menu keyboard for clients
 */
const getClientMenuKeyboard = (ctx) => {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: global.i18n.t(ctx, 'menu.create_order'), callback_data: 'client:create_order' },
                    { text: global.i18n.t(ctx, 'menu.my_orders'), callback_data: 'client:my_orders' }
                ],
                [
                    { text: global.i18n.t(ctx, 'menu.my_profile'), callback_data: 'profile:view' },
                    { text: global.i18n.t(ctx, 'menu.settings'), callback_data: 'settings:main' }
                ],
                [
                    { text: global.i18n.t(ctx, 'buttons.help'), callback_data: 'help:main' }
                ]
            ]
        }
    };
};

/**
 * Get main menu keyboard based on user role
 */
const getMainMenuKeyboard = (ctx, user) => {
    if (user && user.isDriver()) {
        return getDriverMenuKeyboard(ctx);
    } else {
        return getClientMenuKeyboard(ctx);
    }
};

/**
 * Get student menu keyboard (legacy, keeping for compatibility)
 */
const getStudentMenuKeyboard = (ctx) => {
    return getClientMenuKeyboard(ctx); // Fallback to client menu
};

/**
 * Get back button keyboard
 */
const getBackButton = (ctx, callbackData = 'menu:main') => {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: global.i18n.t(ctx, 'buttons.back'), callback_data: callbackData }]
            ]
        }
    };
};

/**
 * Get confirmation keyboard (Yes/No)
 */
const getConfirmationKeyboard = (ctx, yesCallback, noCallback = 'cancel') => {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: global.i18n.t(ctx, 'buttons.yes'), callback_data: yesCallback },
                    { text: global.i18n.t(ctx, 'buttons.no'), callback_data: noCallback }
                ]
            ]
        }
    };
};

/**
 * Get pagination keyboard
 */
const getPaginationKeyboard = (ctx, currentPage, totalPages, baseCallback) => {
    const keyboard = [];

    if (totalPages > 1) {
        const row = [];

        if (currentPage > 1) {
            row.push({
                text: '◀️',
                callback_data: `${baseCallback}:${currentPage - 1}`
            });
        }

        row.push({
            text: `${currentPage}/${totalPages}`,
            callback_data: 'noop'
        });

        if (currentPage < totalPages) {
            row.push({
                text: '▶️',
                callback_data: `${baseCallback}:${currentPage + 1}`
            });
        }

        keyboard.push(row);
    }

    keyboard.push([{ text: global.i18n.t(ctx, 'buttons.back'), callback_data: 'menu:main' }]);

    return { reply_markup: { inline_keyboard: keyboard } };
};

/**
 * Format user info for display
 */
const formatUserInfo = (user, ctx) => {
    const role = user.isDriver() ? 'Водитель' : 'Заказчик';
    const phone = user.profile.phoneNumber || 'Не указан';
    const location = user.driverInfo?.currentLocation || 'Не указано';

    let info = global.i18n.t(ctx, 'profile.info', {
        fullName: user.profile.fullName,
        birthYear: user.profile.birthYear || 'Не указан',
        role: role,
        phone: phone,
        location: location,
        rating: user.reputation.rating.toFixed(1),
        completedDeals: user.reputation.completedDeals,
        activeOrders: user.activeOrders,
        maxOrders: user.maxOrders
    });

    if (user.isDriver() && user.driverInfo.vehicleModel) {
        const vehicleCategory = user.driverInfo.vehicleCategory || 'Не указана';
        info += global.i18n.t(ctx, 'profile.vehicle_info', {
            vehicleModel: user.driverInfo.vehicleModel,
            vehicleCategory: vehicleCategory
        });
    }

    return info;
};

/**
 * Format order summary for display
 */
const formatOrderSummary = (order, ctx) => {
    const from = order.cargo.from || 'Не указано';
    const to = order.cargo.to || 'По договоренности';
    const date = order.cargo.scheduledDate
        ? new Date(order.cargo.scheduledDate).toLocaleDateString('ru-RU')
        : 'По договоренности';
    const price = order.cargo.price ? `${order.cargo.price} сум` : 'По договоренности';
    const description = order.cargo.description || 'Не указано';
    const contact = order.contactInfo?.contactName || 'См. профиль';
    const status = global.i18n.t(ctx, `status.${order.status}`);

    return global.i18n.t(ctx, 'orders.order_details', {
        orderId: order._id.toString().slice(-6),
        from,
        to,
        date,
        price,
        description,
        contact,
        status
    });
};

/**
 * Escape markdown special characters
 */
const escapeMarkdown = (text) => {
    if (typeof text !== 'string') return text;
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
};

/**
 * Validate phone number format
 */
const validatePhoneNumber = (phone) => {
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,15}$/;
    return phoneRegex.test(phone);
};

/**
 * Format phone number for display
 */
const formatPhoneNumber = (phone) => {
    if (!phone) return null;

    // Remove all non-digit characters except +
    const cleaned = phone.replace(/[^\d+]/g, '');

    // If it starts with 998 (Uzbekistan), add + if missing
    if (cleaned.startsWith('998') && !cleaned.startsWith('+')) {
        return '+' + cleaned;
    }

    return cleaned;
};

/**
 * Get distance between two cities (simplified implementation)
 */
const calculateDistance = (city1, city2) => {
    // Simplified distance calculation
    // In a real implementation, you would use geocoding API
    if (!city1 || !city2) return 0;

    city1 = city1.toLowerCase().trim();
    city2 = city2.toLowerCase().trim();

    if (city1 === city2) return 0;

    // Mock distances for common Uzbek cities
    const distances = {
        'ташкент-самарканд': 280,
        'ташкент-бухара': 440,
        'ташкент-андижан': 370,
        'ташкент-наманган': 310,
        'ташкент-фергана': 340,
        'самарканд-бухара': 160,
        'бухара-хива': 450
    };

    const key1 = `${city1}-${city2}`;
    const key2 = `${city2}-${city1}`;

    return distances[key1] || distances[key2] || Math.floor(Math.random() * 500) + 100;
};

module.exports = {
    getOrCreateUser,
    isGroupChat,
    isStudent,
    getMainMenuKeyboard,
    getDriverMenuKeyboard,
    getClientMenuKeyboard,
    getStudentMenuKeyboard,
    getBackButton,
    getConfirmationKeyboard,
    getPaginationKeyboard,
    formatUserInfo,
    formatOrderSummary,
    escapeMarkdown,
    validatePhoneNumber,
    formatPhoneNumber,
    calculateDistance
};