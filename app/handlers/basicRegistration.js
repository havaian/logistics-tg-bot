const redisService = require('../services/redisService');
const User = require('../models/user');
const keyboardManager = require('../utils/keyboardManager');

/**
 * Handle role selection for new users
 */
const handleRoleSelection = async (ctx, messageText) => {
    const userId = ctx.from.id;

    // Validate input
    if (!keyboardManager.validateInput(ctx, 'role_selection', null, messageText)) {
        await keyboardManager.showKeyboardForState(ctx, 'role_selection');
        return true;
    }

    // Process role selection
    let selectedRole;
    if (messageText === global.i18n.t(ctx, 'registration.role_client')) {
        selectedRole = 'client';
    } else if (messageText === global.i18n.t(ctx, 'registration.role_driver')) {
        selectedRole = 'driver';
    }

    if (selectedRole) {
        // Update user and state
        ctx.user.profile.role = selectedRole;
        await ctx.user.save();

        await redisService.updateUserStateField(userId, 'current', 'basic_info');
        await redisService.updateUserStateField(userId, 'step', 'first_name');
        await redisService.updateUserStateField(userId, 'data', { role: selectedRole, basicInfoStep: 'first_name' });

        await ctx.reply(
            global.i18n.t(ctx, 'registration.role_selected', { role: messageText }),
            { reply_markup: { remove_keyboard: true } }
        );

        // Show next step keyboard
        setTimeout(async () => {
            await keyboardManager.showKeyboardForState(ctx, 'basic_info', 'first_name');
        }, 500);

        global.logger.logUserAction('user_selected_role', ctx, {
            role: selectedRole
        });

        return true;
    }

    return false;
};

/**
 * Handle basic info collection with explicit step support
 */
const handleBasicInfo = async (ctx, messageText, currentStep = null) => {
    const userId = ctx.from.id;
    const userState = ctx.userState;
    const regData = userState.data || {};

    // Use provided step or derive from state data
    let step = currentStep || regData.basicInfoStep || 'first_name';

    console.log(`Handling basic info - step: ${step}`, '3');

    switch (step) {
        case 'first_name':
            if (!keyboardManager.validateInput(ctx, 'basic_info', 'first_name', messageText)) {
                await keyboardManager.showKeyboardForState(ctx, 'basic_info', 'first_name');
                return true;
            }

            regData.firstName = messageText.trim();
            regData.basicInfoStep = 'last_name';

            await redisService.updateUserStateField(userId, 'step', 'last_name');
            await redisService.updateUserStateField(userId, 'data', regData);

            await keyboardManager.showKeyboardForState(ctx, 'basic_info', 'last_name');
            return true;

        case 'last_name':
            if (!keyboardManager.validateInput(ctx, 'basic_info', 'last_name', messageText)) {
                await keyboardManager.showKeyboardForState(ctx, 'basic_info', 'last_name');
                return true;
            }

            regData.lastName = messageText.trim();
            regData.basicInfoStep = 'birth_year';

            await redisService.updateUserStateField(userId, 'step', 'birth_year');
            await redisService.updateUserStateField(userId, 'data', regData);

            await keyboardManager.showKeyboardForState(ctx, 'basic_info', 'birth_year');
            return true;

        case 'birth_year':
            const year = parseInt(messageText);
            const currentYear = new Date().getFullYear();

            if (isNaN(year) || year < 1900 || year > currentYear - 16) {
                await ctx.reply(global.i18n.t(ctx, 'registration.invalid_year'));
                await keyboardManager.showKeyboardForState(ctx, 'basic_info', 'birth_year');
                return true;
            }

            regData.birthYear = year;
            regData.basicInfoStep = 'phone';

            await redisService.updateUserStateField(userId, 'step', 'phone');
            await redisService.updateUserStateField(userId, 'data', regData);

            await keyboardManager.showKeyboardForState(ctx, 'basic_info', 'phone');
            return true;

        case 'phone':
            // Handle contact sharing
            console.log('Contact data:', ctx.message.contact, "4");

            if (!ctx.message.contact) {
                await ctx.reply(global.i18n.t(ctx, 'registration.share_contact_please'));
                await keyboardManager.showKeyboardForState(ctx, 'basic_info', 'phone');
                return true;
            }

            if (ctx.message.contact.user_id !== ctx.from.id) {
                await ctx.reply(global.i18n.t(ctx, 'registration.share_your_own_contact'));
                await keyboardManager.showKeyboardForState(ctx, 'basic_info', 'phone');
                return true;
            }

            console.log('Contact validation passed, completing basic info');

            // Update user in DB
            ctx.user.profile.firstName = regData.firstName;
            ctx.user.profile.lastName = regData.lastName;
            ctx.user.profile.birthYear = regData.birthYear;
            ctx.user.profile.phoneNumber = ctx.message.contact.phone_number;
            await ctx.user.save();

            // Move to next state
            const nextState = ctx.user.isDriver() ? 'first_offer' : 'first_order';
            const nextStep = ctx.user.isDriver() ? 'vehicle_model' : 'from_location';

            await redisService.updateUserStateField(userId, 'current', nextState);
            await redisService.updateUserStateField(userId, 'step', nextStep);
            await redisService.updateUserStateField(userId, 'data', {
                [ctx.user.isDriver() ? 'offerStep' : 'orderStep']: nextStep
            });

            await ctx.reply(
                global.i18n.t(ctx, 'registration.basic_info_completed'),
                { reply_markup: { remove_keyboard: true } }
            );

            // Start first order/offer creation
            setTimeout(async () => {
                if (ctx.user.isDriver()) {
                    await ctx.reply(global.i18n.t(ctx, 'registration.create_first_offer'));
                    await keyboardManager.showKeyboardForState(ctx, 'first_offer', 'vehicle_model');
                } else {
                    await ctx.reply(global.i18n.t(ctx, 'registration.create_first_order'));
                    await keyboardManager.showKeyboardForState(ctx, 'first_order', 'from_location');
                }
            }, 1000);

            global.logger.logAction('basic_registration_completed', {
                userId: ctx.user._id,
                role: ctx.user.profile.role
            });

            return true;

        default:
            global.logger.logWarning(`Unknown basic_info step: ${step}`, ctx);
            return false;
    }
};

/**
 * Complete registration and clean up state
 */
const completeRegistration = async (userId) => {
    try {
        // Update user in DB
        const user = await User.findByTelegramId(userId);
        if (user) {
            user.registrationCompleted = true;
            await user.save();
        }

        // Update state to completed
        await redisService.updateUserStateField(userId, 'current', 'completed');
        await redisService.updateUserStateField(userId, 'step', null);

        // Clean up registration data
        await redisService.deleteRegistrationData(userId);

        global.logger.logAction('user_registration_completed', {
            userId,
            role: user?.profile?.role
        });

        return true;
    } catch (error) {
        global.logger.logError('Error completing registration:', error);
        return false;
    }
};

module.exports = {
    handleRoleSelection,
    handleBasicInfo,
    completeRegistration
};