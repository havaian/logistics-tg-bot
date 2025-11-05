const redisService = require('../services/redisService');
const User = require('../models/user');
const basicRegistration = require('../handlers/basicRegistration');
const keyboardManager = require('../utils/keyboardManager'); // New utility

/**
 * Determine user's current state AND step based on existing data
 * @param {Object} user - User document from DB
 * @param {Object} existingStateData - Existing state data from Redis
 * @returns {Object} - { state, step, data }
 */
function deriveUserStateWithStep(user, existingStateData = {}) {
    // If user doesn't exist or no role selected
    if (!user || !user.profile.role) {
        return {
            state: 'role_selection',
            step: null,
            data: existingStateData.data || {}
        };
    }

    // If basic info missing - determine exact step
    if (!user.profile.firstName || !user.profile.phoneNumber) {
        const step = deriveBasicInfoStep(user, existingStateData.data || {});
        return {
            state: 'basic_info',
            step: step,
            data: {
                ...existingStateData.data,
                basicInfoStep: step,
                role: user.profile.role
            }
        };
    }

    // If registration not completed, need first order/offer
    if (!user.registrationCompleted) {
        const nextState = user.isDriver() ? 'first_offer' : 'first_order';
        const step = nextState === 'first_offer'
            ? deriveOfferStep(user, existingStateData.data || {})
            : deriveOrderStep(existingStateData.data || {});

        return {
            state: nextState,
            step: step,
            data: {
                ...existingStateData.data,
                [nextState === 'first_offer' ? 'offerStep' : 'orderStep']: step
            }
        };
    }

    // User is fully registered
    return {
        state: 'completed',
        step: null,
        data: {}
    };
}

/**
 * Determine the exact step within basic_info state
 */
function deriveBasicInfoStep(user, stateData) {
    // If we have step info in state data and it makes sense, use it
    if (stateData.basicInfoStep) {
        const validSteps = ['first_name', 'last_name', 'birth_year', 'phone'];
        if (validSteps.includes(stateData.basicInfoStep)) {
            // Validate that this step actually makes sense given current user data
            switch (stateData.basicInfoStep) {
                case 'first_name':
                    if (!user.profile.firstName) return 'first_name';
                    break;
                case 'last_name':
                    if (user.profile.firstName && !user.profile.lastName) return 'last_name';
                    break;
                case 'birth_year':
                    if (user.profile.firstName && user.profile.lastName && !user.profile.birthYear) return 'birth_year';
                    break;
                case 'phone':
                    if (user.profile.firstName && user.profile.lastName && user.profile.birthYear && !user.profile.phoneNumber) return 'phone';
                    break;
            }
        }
    }

    // Derive step from user data
    if (!user.profile.firstName) return 'first_name';
    if (!user.profile.lastName) return 'last_name';
    if (!user.profile.birthYear) return 'birth_year';
    if (!user.profile.phoneNumber) return 'phone';

    return 'first_name'; // Fallback
}

/**
 * Determine the exact step within first_order state
 */
function deriveOrderStep(stateData) {
    if (stateData.orderStep) {
        const validSteps = ['from_location', 'to_location', 'description', 'price'];
        if (validSteps.includes(stateData.orderStep)) {
            return stateData.orderStep;
        }
    }
    return 'from_location';
}

/**
 * Determine the exact step within first_offer state
 */
function deriveOfferStep(user, stateData) {
    if (stateData.offerStep) {
        const validSteps = ['vehicle_model', 'vehicle_category', 'current_location'];
        if (validSteps.includes(stateData.offerStep)) {
            return stateData.offerStep;
        }
    }
    return 'vehicle_model';
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

        // Get existing state from Redis
        let existingUserState = await redisService.getUserState(userId);

        // Derive the correct state with step
        const derivedState = deriveUserStateWithStep(user, existingUserState);

        // For new users or when state doesn't exist, use derived state
        if (isNewUser || !existingUserState) {
            existingUserState = {
                current: derivedState.state,
                step: derivedState.step,
                data: derivedState.data
            };

            // Save state to Redis if user needs registration
            if (derivedState.state !== 'completed') {
                await redisService.setUserState(userId, existingUserState);
            }
        } else {
            // For existing users, validate and potentially fix state
            const currentStateIsValid = validateCurrentState(user, existingUserState);
            if (!currentStateIsValid) {
                global.logger.logInfo(`Fixing invalid state for user ${userId}`, ctx);
                existingUserState = {
                    current: derivedState.state,
                    step: derivedState.step,
                    data: derivedState.data
                };
                await redisService.setUserState(userId, existingUserState);
            }
        }

        // Add state to context
        ctx.userState = existingUserState;

        // Special handling for /start command
        if (ctx.message?.text === '/start') {
            await handleStartCommand(ctx, user, existingUserState);
            return;
        }

        // If user is completed, proceed normally
        if (existingUserState.current === 'completed') {
            return next();
        }

        // Handle registration states
        const handled = await handleRegistrationStates(ctx, existingUserState);
        if (handled) {
            return; // State handler took care of the message
        }

        // If not handled by state handlers, proceed to normal handlers
        return next();

    } catch (error) {
        global.logger.logError('Error in user state middleware:', ctx, error);
        await ctx.reply(global.i18n.t(ctx, 'errors.general'));
    }
};

/**
 * Validate if current state makes sense for user
 */
function validateCurrentState(user, userState) {
    const derived = deriveUserStateWithStep(user, userState);

    // If derived state is different from current state, state is invalid
    if (derived.state !== userState.current) {
        return false;
    }

    // Additional validation for steps could go here
    return true;
}

/**
 * Handle /start command with proper state recovery
 */
async function handleStartCommand(ctx, user, userState) {
    const userId = ctx.from.id;

    // If user is completed, show welcome and main menu
    if (userState.current === 'completed') {
        await ctx.reply(global.i18n.t(ctx, 'start.welcome_back', { name: user.profile.firstName }));
        const keyboardMenus = require('../handlers/keyboardMenus');
        setTimeout(async () => {
            await keyboardMenus.showMainMenu(ctx, user);
        }, 1000);
        return;
    }

    // For users in registration, show current step with proper keyboard
    await ctx.reply(global.i18n.t(ctx, 'start.welcome'));

    // Show the appropriate keyboard for current state/step
    await keyboardManager.showKeyboardForState(ctx, userState.current, userState.step, userState.data);
}

/**
 * Handle messages for users in registration states
 */
const handleRegistrationStates = async (ctx, userState) => {
    try {
        const messageText = ctx.message?.text;
        const currentState = userState.current;
        const currentStep = userState.step;

        console.log(messageText, "1");
        console.log(currentState, "2");
        console.log(currentStep, "3");

        switch (currentState) {
            case 'role_selection':
                return await basicRegistration.handleRoleSelection(ctx, messageText);

            case 'basic_info':
                return await basicRegistration.handleBasicInfo(ctx, messageText, currentStep);

            case 'first_order':
                return await handleFirstOrder(ctx, messageText, currentStep);

            case 'first_offer':
                return await handleFirstOffer(ctx, messageText, currentStep);

            default:
                return false;
        }
    } catch (error) {
        global.logger.logError('Error handling registration state:', ctx, error);
        return false;
    }
};

// ... (rest of handleFirstOrder and handleFirstOffer functions remain similar, 
// but they should also accept currentStep parameter for better control)

module.exports = {
    userStateMiddleware,
    completeRegistration: require('../handlers/basicRegistration').completeRegistration,
    resetUserState: async (userId) => {
        try {
            await redisService.deleteUserState(userId);
            await redisService.deleteRegistrationData(userId);

            global.logger.logAction('user_state_reset', { userId });
            return true;
        } catch (error) {
            global.logger.logError('Error resetting user state:', {}, error);
            return false;
        }
    },
    deriveUserStateWithStep
};