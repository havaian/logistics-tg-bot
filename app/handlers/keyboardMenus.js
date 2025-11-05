/**
 * Get main menu keyboard based on user role
 * @param {Object} ctx - Telegraf context
 * @param {Object} user - User document
 * @returns {Object} - Keyboard markup
 */
const getMainMenuKeyboard = (ctx, user) => {
    if (!user || !user.profile.role) {
        return { remove_keyboard: true };
    }

    let keyboard;

    if (user.isClient()) {
        keyboard = [
            [{ text: global.i18n.t(ctx, 'menu.create_order') }],
            [
                { text: global.i18n.t(ctx, 'menu.my_deals') },
                { text: global.i18n.t(ctx, 'menu.my_orders') }
            ],
            [
                { text: global.i18n.t(ctx, 'menu.profile') },
                { text: global.i18n.t(ctx, 'menu.language') }
            ]
        ];
    } else if (user.isDriver()) {
        keyboard = [
            [{ text: global.i18n.t(ctx, 'menu.create_offer') }],
            [
                { text: global.i18n.t(ctx, 'menu.my_deals') },
                { text: global.i18n.t(ctx, 'menu.my_offers') }
            ],
            [
                { text: global.i18n.t(ctx, 'menu.profile') },
                { text: global.i18n.t(ctx, 'menu.language') }
            ]
        ];
    } else {
        // Fallback for users without role
        keyboard = [
            [{ text: global.i18n.t(ctx, 'menu.profile') }],
            [{ text: global.i18n.t(ctx, 'menu.language') }]
        ];
    }

    return {
        keyboard: keyboard,
        resize_keyboard: true,
        persistent: true
    };
};

/**
 * Get language selection keyboard
 * @param {Object} ctx - Telegraf context
 * @returns {Object} - Keyboard markup
 */
const getLanguageKeyboard = (ctx) => {
    const keyboard = [
        [{ text: '🇷🇺 Русский' }],
        [{ text: '🇺🇿 O\'zbek' }],
        [{ text: '🇺🇸 English' }],
        [{ text: global.i18n.t(ctx, 'buttons.back') }]
    ];

    return {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: true
    };
};

/**
 * Show main menu to user
 * @param {Object} ctx - Telegraf context
 * @param {Object} user - User document
 * @param {string} message - Optional custom message
 */
const showMainMenu = async (ctx, user, message = null) => {
    try {
        const menuMessage = message || global.i18n.t(ctx, user.isDriver() ? 'menu.main_driver' : 'menu.main_client');
        const keyboard = getMainMenuKeyboard(ctx, user);

        await ctx.reply(menuMessage, { reply_markup: keyboard });

        global.logger.logAction('main_menu_shown', {
            userId: user._id,
            role: user.profile.role
        });
    } catch (error) {
        global.logger.logError('Error showing main menu:', ctx, error);
        await ctx.reply(global.i18n.t(ctx, 'errors.general'));
    }
};

/**
 * Handle keyboard menu selections
 * @param {Object} ctx - Telegraf context
 * @returns {boolean} - Whether the message was handled
 */
const handleKeyboardMenu = async (ctx) => {
    try {
        const messageText = ctx.message?.text;
        const user = ctx.user;

        if (!messageText || !user) {
            return false;
        }

        // Handle menu selections
        switch (messageText) {
            // Order/Offer creation
            case global.i18n.t(ctx, 'menu.create_order'):
                if (user.isClient()) {
                    const orderHandlers = require('./orders');
                    await orderHandlers.startOrderCreation(ctx);
                    return true;
                }
                break;

            case global.i18n.t(ctx, 'menu.create_offer'):
                if (user.isDriver()) {
                    const driverHandlers = require('./drivers');
                    await driverHandlers.startOfferCreation(ctx);
                    return true;
                }
                break;

            // Deals and Orders/Offers
            case global.i18n.t(ctx, 'menu.my_deals'):
                const matchingHandlers = require('./matching');
                await matchingHandlers.showMyDeals(ctx);
                return true;

            case global.i18n.t(ctx, 'menu.my_orders'):
                if (user.isClient()) {
                    const orderHandlers = require('./orders');
                    await orderHandlers.showMyOrders(ctx);
                    return true;
                }
                break;

            case global.i18n.t(ctx, 'menu.my_offers'):
                if (user.isDriver()) {
                    const driverHandlers = require('./drivers');
                    await driverHandlers.showMyOffers(ctx);
                    return true;
                }
                break;

            // Profile and Settings
            case global.i18n.t(ctx, 'menu.profile'):
                const profileHandlers = require('./profile');
                await profileHandlers.showProfile(ctx);
                return true;

            case global.i18n.t(ctx, 'menu.language'):
                await showLanguageMenu(ctx);
                return true;

            // Language selection
            case '🇷🇺 Русский':
                await changeLanguage(ctx, 'ru');
                return true;

            case '🇺🇿 O\'zbek':
                await changeLanguage(ctx, 'uz');
                return true;

            case '🇺🇸 English':
                await changeLanguage(ctx, 'en');
                return true;

            // Back button
            case global.i18n.t(ctx, 'buttons.back'):
                await showMainMenu(ctx, user);
                return true;

            default:
                return false;
        }

        return false;
    } catch (error) {
        global.logger.logError('Error handling keyboard menu:', ctx, error);
        return false;
    }
};

/**
 * Show language selection menu
 * @param {Object} ctx - Telegraf context
 */
const showLanguageMenu = async (ctx) => {
    try {
        const keyboard = getLanguageKeyboard(ctx);

        await ctx.reply(
            global.i18n.t(ctx, 'language.select'),
            { reply_markup: keyboard }
        );

        global.logger.logAction('language_menu_shown', {
            userId: ctx.from.id
        });
    } catch (error) {
        global.logger.logError('Error showing language menu:', ctx, error);
        await ctx.reply(global.i18n.t(ctx, 'errors.general'));
    }
};

/**
 * Change user language
 * @param {Object} ctx - Telegraf context
 * @param {string} locale - New language locale
 */
const changeLanguage = async (ctx, locale) => {
    try {
        const user = ctx.user;

        // Update user language
        user.language = locale;
        await user.save();

        // Update context locale
        ctx.locale = locale;

        await ctx.reply(
            global.i18n.t(ctx, 'language.changed'),
            { reply_markup: { remove_keyboard: true } }
        );

        // Show updated main menu
        setTimeout(async () => {
            await showMainMenu(ctx, user);
        }, 500);

        global.logger.logAction('language_changed', {
            userId: user._id,
            newLanguage: locale
        });
    } catch (error) {
        global.logger.logError('Error changing language:', ctx, error);
        await ctx.reply(global.i18n.t(ctx, 'errors.general'));
    }
};

/**
 * Remove keyboard (utility function)
 * @param {Object} ctx - Telegraf context
 * @param {string} message - Message to send with removed keyboard
 */
const removeKeyboard = async (ctx, message = null) => {
    try {
        const text = message || global.i18n.t(ctx, 'keyboard.removed');
        await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
    } catch (error) {
        global.logger.logError('Error removing keyboard:', ctx, error);
    }
};

/**
 * Check if message is a keyboard menu item
 * @param {string} messageText - Message text to check
 * @param {Object} ctx - Telegraf context for translations
 * @returns {boolean} - Whether it's a menu item
 */
const isKeyboardMenuItem = (messageText, ctx) => {
    const menuItems = [
        global.i18n.t(ctx, 'menu.create_order'),
        global.i18n.t(ctx, 'menu.create_offer'),
        global.i18n.t(ctx, 'menu.my_deals'),
        global.i18n.t(ctx, 'menu.my_orders'),
        global.i18n.t(ctx, 'menu.my_offers'),
        global.i18n.t(ctx, 'menu.profile'),
        global.i18n.t(ctx, 'menu.language'),
        '🇷🇺 Русский',
        '🇺🇿 O\'zbek',
        '🇺🇸 English',
        global.i18n.t(ctx, 'buttons.back')
    ];

    return menuItems.includes(messageText);
};

/**
 * Get back button keyboard
 * @param {Object} ctx - Telegraf context
 * @returns {Object} - Keyboard markup with just back button
 */
const getBackKeyboard = (ctx) => {
    return {
        keyboard: [[{ text: global.i18n.t(ctx, 'buttons.back') }]],
        resize_keyboard: true,
        one_time_keyboard: true
    };
};

module.exports = {
    getMainMenuKeyboard,
    getLanguageKeyboard,
    showMainMenu,
    handleKeyboardMenu,
    showLanguageMenu,
    changeLanguage,
    removeKeyboard,
    isKeyboardMenuItem,
    getBackKeyboard
};