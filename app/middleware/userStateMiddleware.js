const redisService = require('../services/redisService');
const User = require('../models/user');
const { t } = require('../utils/i18nHelper');
const basicRegistration = require('../handlers/basicRegistration');

/**
 * Determine user's current state based on existing data
 * @param {Object} user - User document from DB
 * @returns {string} - Current state
 */
function deriveUserState(user) {
    // If user doesn't exist or no role selected
    if (!user || !user.profile.role) {
        return 'role_selection';
    }

    // If basic info missing
    if (!user.profile.firstName || !user.profile.phoneNumber) {
        return 'basic_info';
    }

    // If registration not completed, need first order/offer
    if (!user.registrationCompleted) {
        return user.isDriver() ? 'first_offer' : 'first_order';
    }

    // User is fully registered
    return 'completed';
}

/**
 * Main state middleware - routes users based on their current state
 */
const userStateMiddleware = async (ctx, next) => {
    try {
        // Skip for callback queries (they have their own handlers)
        if (ctx.callbackQuery) {
            return next();
        }

        // Skip for group chats
        if (ctx.chat.type !== 'private') {
            return next();
        }

        const userId = ctx.from.id;

        // Get or create user from DB
        let user = await User.findByTelegramId(userId);
        let isNewUser = false;
        
        if (!user) {
            user = new User({
                telegramId: userId,
                profile: {
                    firstName: ctx.from.first_name || '',
                    lastName: ctx.from.last_name || ''
                },
                language: ctx.locale || 'ru'
            });
            await user.save();
            isNewUser = true;

            global.logger.logAction('user_created', {
                userId: user._id,
                telegramId: userId,
                username: ctx.from.username
            });
        }

        // Add user to context
        ctx.user = user;

        // Get state from Redis, fallback to derived state
        let userState = await redisService.getUserState(userId);
        
        // For new users, always start fresh (ignore any stale Redis state)
        if (isNewUser || !userState) {
            const derivedState = deriveUserState(user);
            userState = {
                current: derivedState,
                data: {}
            };

            // Save state to Redis if user needs registration
            if (derivedState !== 'completed') {
                await redisService.setUserState(userId, userState);
            }
        }

        // Add state to context
        ctx.userState = userState;

        // Route based on current state
        const currentState = userState.current;

        // Special handling for /start command - always reset to proper state
        if (ctx.message?.text === '/start') {
            const properState = deriveUserState(user);
            if (properState !== currentState) {
                global.logger.logInfo(`Resetting user state from ${currentState} to ${properState} due to /start command`, ctx);
                userState = {
                    current: properState,
                    data: {}
                };
                await redisService.setUserState(userId, userState);
                ctx.userState = userState;
            }
            
            // If user is completed, let the /start handler in index.js take over
            if (properState === 'completed') {
                return next();
            }
        }

        // If user is completed, proceed normally
        if (userState.current === 'completed') {
            return next();
        }

        // Handle registration states
        const handled = await handleRegistrationStates(ctx, userState.current);
        if (handled) {
            return; // State handler took care of the message
        }

        // If not handled by state handlers, proceed to normal handlers
        return next();

    } catch (error) {
        global.logger.logError('Error in user state middleware:', ctx, error);
        await ctx.reply(t(ctx, 'errors.general'));
    }
};

/**
 * Handle messages for users in registration states
 * @param {Object} ctx - Telegraf context
 * @param {string} currentState - Current user state
 * @returns {boolean} - Whether the message was handled
 */
const handleRegistrationStates = async (ctx, currentState) => {
    try {
        const messageText = ctx.message?.text;

        console.log(messageText, "1")
        console.log(currentState, "2")

        switch (currentState) {
            case 'role_selection':
                return await basicRegistration.handleRoleSelection(ctx, messageText);
            
            case 'basic_info':
                return await basicRegistration.handleBasicInfo(ctx, messageText);
            
            case 'first_order':
                return await handleFirstOrder(ctx, messageText);
            
            case 'first_offer':
                return await handleFirstOffer(ctx, messageText);
            
            default:
                return false;
        }
    } catch (error) {
        global.logger.logError('Error handling registration state:', ctx, error);
        return false;
    }
};

/**
 * Handle first order creation for clients
 */
const handleFirstOrder = async (ctx, messageText) => {
    const userId = ctx.from.id;
    const userState = ctx.userState;
    const orderData = userState.data || {};

    // Determine current step
    let currentStep = orderData.orderStep || 'from_location';

    switch (currentStep) {
        case 'from_location':
            if (!messageText || messageText.trim().length < 2) {
                await ctx.reply(t(ctx, 'orders.enter_from'));
                return true;
            }

            orderData.from = messageText.trim();
            orderData.orderStep = 'to_location';
            await redisService.updateUserStateField(userId, 'data', orderData);
            
            // Show skip button for destination
            const toKeyboard = [[{ text: t(ctx, 'orders.skip') }]];
            await ctx.reply(
                t(ctx, 'orders.enter_to'),
                {
                    reply_markup: {
                        keyboard: toKeyboard,
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            return true;

        case 'to_location':
            if (messageText && messageText.trim() !== t(ctx, 'orders.skip')) {
                orderData.to = messageText.trim();
            }
            orderData.orderStep = 'description';
            await redisService.updateUserStateField(userId, 'data', orderData);
            
            // Show skip button for description
            const descKeyboard = [[{ text: t(ctx, 'orders.skip') }]];
            await ctx.reply(
                t(ctx, 'orders.enter_description'),
                {
                    reply_markup: {
                        keyboard: descKeyboard,
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            return true;

        case 'description':
            if (messageText && messageText.trim() !== t(ctx, 'orders.skip')) {
                orderData.description = messageText.trim();
            }
            orderData.orderStep = 'price';
            await redisService.updateUserStateField(userId, 'data', orderData);
            
            // Show skip button for price
            const priceKeyboard = [[{ text: t(ctx, 'orders.skip') }]];
            await ctx.reply(
                t(ctx, 'orders.enter_price'),
                {
                    reply_markup: {
                        keyboard: priceKeyboard,
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            return true;

        case 'price':
            if (messageText && messageText.trim() !== t(ctx, 'orders.skip')) {
                const price = parseInt(messageText.replace(/\D/g, ''));
                if (!isNaN(price) && price > 0) {
                    orderData.price = price;
                }
            }
            
            // Create the order
            const Order = require('../models/order');
            const newOrder = new Order({
                clientId: ctx.user._id,
                cargo: {
                    from: orderData.from,
                    to: orderData.to || '',
                    description: orderData.description || '',
                    price: orderData.price || 0
                },
                status: 'active'
            });
            
            await newOrder.save();

            // Complete registration
            await basicRegistration.completeRegistration(userId);
            
            await ctx.reply(
                t(ctx, 'orders.order_created', { orderId: newOrder._id.toString().slice(-6) }),
                { reply_markup: { remove_keyboard: true } }
            );

            // Show main menu
            const keyboardMenus = require('../handlers/keyboardMenus');
            setTimeout(async () => {
                await keyboardMenus.showMainMenu(ctx, ctx.user);
            }, 1500);

            return true;

        default:
            return false;
    }
};

/**
 * Handle first offer creation for drivers
 */
const handleFirstOffer = async (ctx, messageText) => {
    const userId = ctx.from.id;
    const userState = ctx.userState;
    const offerData = userState.data || {};

    // Determine current step
    let currentStep = offerData.offerStep || 'vehicle_model';

    switch (currentStep) {
        case 'vehicle_model':
            if (!messageText || messageText.trim().length < 2) {
                await ctx.reply(t(ctx, 'registration.enter_vehicle_model'));
                return true;
            }

            offerData.vehicleModel = messageText.trim();
            offerData.offerStep = 'vehicle_category';
            await redisService.updateUserStateField(userId, 'data', offerData);

            // Show vehicle category keyboard
            const keyboard = [
                [{ text: t(ctx, 'registration.vehicle_categories.light') }],
                [{ text: t(ctx, 'registration.vehicle_categories.medium') }],
                [{ text: t(ctx, 'registration.vehicle_categories.heavy') }],
                [{ text: t(ctx, 'registration.vehicle_categories.special') }]
            ];

            await ctx.reply(
                t(ctx, 'registration.choose_vehicle_category'),
                {
                    reply_markup: {
                        keyboard: keyboard,
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            return true;

        case 'vehicle_category':
            let category = '';
            if (messageText === t(ctx, 'registration.vehicle_categories.light')) category = 'light';
            else if (messageText === t(ctx, 'registration.vehicle_categories.medium')) category = 'medium';
            else if (messageText === t(ctx, 'registration.vehicle_categories.heavy')) category = 'heavy';
            else if (messageText === t(ctx, 'registration.vehicle_categories.special')) category = 'special';
            else {
                await ctx.reply(t(ctx, 'registration.choose_vehicle_category'));
                return true;
            }

            offerData.vehicleCategory = category;
            offerData.offerStep = 'current_location';
            await redisService.updateUserStateField(userId, 'data', offerData);
            
            await ctx.reply(
                t(ctx, 'registration.enter_current_location'),
                { reply_markup: { remove_keyboard: true } }
            );
            return true;

        case 'current_location':
            if (!messageText || messageText.trim().length < 2) {
                await ctx.reply(t(ctx, 'registration.enter_current_location'));
                return true;
            }

            // Update user driver info
            ctx.user.driverInfo.vehicleModel = offerData.vehicleModel;
            ctx.user.driverInfo.vehicleCategory = offerData.vehicleCategory;
            ctx.user.driverInfo.currentLocation = messageText.trim();
            await ctx.user.save();

            // Complete registration
            await basicRegistration.completeRegistration(userId);
            
            await ctx.reply(
                t(ctx, 'drivers.offer_created'),
                { reply_markup: { remove_keyboard: true } }
            );

            // Show main menu
            const keyboardMenus = require('../handlers/keyboardMenus');
            setTimeout(async () => {
                await keyboardMenus.showMainMenu(ctx, ctx.user);
            }, 1500);

            return true;

        default:
            return false;
    }
};

/**
 * Complete user registration
 */
const completeRegistration = async (userId) => {
    return await basicRegistration.completeRegistration(userId);
};

/**
 * Reset user state (for admin or debugging)
 */
const resetUserState = async (userId) => {
    try {
        await redisService.deleteUserState(userId);
        await redisService.deleteRegistrationData(userId);
        
        global.logger.logAction('user_state_reset', { userId });
        return true;
    } catch (error) {
        global.logger.logError('Error resetting user state:', {}, error);
        return false;
    }
};

module.exports = {
    userStateMiddleware,
    completeRegistration,
    resetUserState,
    deriveUserState
};