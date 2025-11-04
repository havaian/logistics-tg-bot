const redisService = require('../services/redisService');
const User = require('../models/user');
const { t } = require('../utils/i18nHelper');

/**
 * Handle role selection for new users
 */
const handleRoleSelection = async (ctx, messageText) => {
    const userId = ctx.from.id;

    // Show role selection keyboard if no message or invalid selection
    if (!messageText || (messageText !== t(ctx, 'registration.role_client') && messageText !== t(ctx, 'registration.role_driver'))) {
        const keyboard = [
            [{ text: t(ctx, 'registration.role_client') }],
            [{ text: t(ctx, 'registration.role_driver') }]
        ];

        await ctx.reply(
            t(ctx, 'start.choose_role'),
            {
                reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            }
        );
        return true;
    }

    // Process role selection
    let selectedRole;
    if (messageText === t(ctx, 'registration.role_client')) {
        selectedRole = 'client';
    } else if (messageText === t(ctx, 'registration.role_driver')) {
        selectedRole = 'driver';
    }

    if (selectedRole) {
        // Update user and state
        ctx.user.profile.role = selectedRole;
        await ctx.user.save();

        await redisService.updateUserStateField(userId, 'current', 'basic_info');
        await redisService.updateUserStateField(userId, 'data', { role: selectedRole });

        await ctx.reply(
            t(ctx, 'registration.role_selected', { role: messageText }),
            { reply_markup: { remove_keyboard: true } }
        );

        // Ask for first name
        setTimeout(async () => {
            await ctx.reply(t(ctx, 'registration.enter_first_name'));
        }, 500);

        global.logger.logUserAction('user_selected_role', ctx, {
            role: selectedRole
        });

        return true;
    }

    return false;
};

/**
 * Handle basic info collection
 */
const handleBasicInfo = async (ctx, messageText) => {
    const userId = ctx.from.id;
    const userState = ctx.userState;
    const regData = userState.data || {};

    // Determine current step
    let currentStep = regData.basicInfoStep || 'first_name';

    console.log(currentStep, '3')

    switch (currentStep) {
        case 'first_name':
            if (!messageText || messageText.trim().length < 2) {
                await ctx.reply(t(ctx, 'registration.enter_first_name'));
                return true;
            }

            regData.firstName = messageText.trim();
            regData.basicInfoStep = 'last_name';
            await redisService.updateUserStateField(userId, 'data', regData);
            await ctx.reply(t(ctx, 'registration.enter_last_name'));
            return true;

        case 'last_name':
            if (!messageText || messageText.trim().length < 2) {
                await ctx.reply(t(ctx, 'registration.enter_last_name'));
                return true;
            }

            regData.lastName = messageText.trim();
            regData.basicInfoStep = 'birth_year';
            await redisService.updateUserStateField(userId, 'data', regData);
            await ctx.reply(t(ctx, 'registration.enter_birth_year'));
            return true;

        case 'birth_year':
            const year = parseInt(messageText);
            const currentYear = new Date().getFullYear();

            if (isNaN(year) || year < 1900 || year > currentYear - 16) {
                await ctx.reply(t(ctx, 'registration.invalid_year'));
                return true;
            }

            regData.birthYear = year;
            regData.basicInfoStep = 'phone';
            await redisService.updateUserStateField(userId, 'data', regData);

            // Request phone number
            const contactKeyboard = [
                [{ text: t(ctx, 'registration.contact_button'), request_contact: true }]
            ];

            await ctx.reply(
                t(ctx, 'registration.share_contact'),
                {
                    reply_markup: {
                        keyboard: contactKeyboard,
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            return true;

        case 'phone':
            // Handle contact sharing
            console.log(ctx.message.contact, "4")
            console.log(ctx.message.contact.user_id, ctx.message.from.id, ctx.chat.id, "5")
            console.log(ctx.message.contact.user_id == ctx.message.from.id == ctx.chat.id, "6")
            if (ctx.message.contact && (ctx.message.contact.user_id == ctx.message.from.id == ctx.chat.id)) {
                console.log('here')
                // // Update user in DB
                // ctx.user.profile.firstName = regData.firstName;
                // ctx.user.profile.lastName = regData.lastName;
                // ctx.user.profile.birthYear = regData.birthYear;
                // ctx.user.profile.phoneNumber = ctx.message.contact.phone_number;
                // await ctx.user.save();

                // // Move to next state
                // const nextState = ctx.user.isDriver() ? 'first_offer' : 'first_order';
                // await redisService.updateUserStateField(userId, 'current', nextState);
                // await redisService.updateUserStateField(userId, 'data', {});

                // await ctx.reply(
                //     t(ctx, 'registration.basic_info_completed'),
                //     { reply_markup: { remove_keyboard: true } }
                // );

                // // Start first order/offer creation
                // setTimeout(async () => {
                //     if (ctx.user.isDriver()) {
                //         await ctx.reply(t(ctx, 'registration.create_first_offer'));
                //         await ctx.reply(t(ctx, 'registration.enter_vehicle_model'));
                //     } else {
                //         await ctx.reply(t(ctx, 'registration.create_first_order'));
                //         await ctx.reply(t(ctx, 'orders.enter_from'));
                //     }
                // }, 1000);

                // global.logger.logAction('basic_registration_completed', {
                //     userId: ctx.user._id,
                //     role: ctx.user.profile.role
                // });

                // return true;
            } else {
                await ctx.reply(t(ctx, 'registration.share_contact_please'));
                return true;
            }

        default:
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