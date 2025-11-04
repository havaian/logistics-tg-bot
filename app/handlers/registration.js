const User = require('../models/user');
const { t } = require('../utils/i18nHelper');

/**
 * Get or create user and check registration status
 */
const getOrCreateUser = async (ctx) => {
    try {
        let user = await User.findByTelegramId(ctx.from.id);

        if (!user) {
            // Create new user
            user = new User({
                telegramId: ctx.from.id,
                profile: {
                    firstName: ctx.from.first_name || '',
                    lastName: ctx.from.last_name || ''
                },
                language: ctx.locale || 'ru'
            });
            await user.save();

            global.logger.logAction('user_created', {
                userId: user._id,
                telegramId: ctx.from.id,
                username: ctx.from.username
            });
        }

        return user;
    } catch (error) {
        throw new Error('Failed to get or create user: ' + error.message);
    }
};

/**
 * Start registration process
 */
const startRegistration = async (ctx) => {
    try {
        const user = await getOrCreateUser(ctx);

        if (user.registrationCompleted) {
            return false; // Already registered
        }

        // Show role selection
        const keyboard = [
            [{ text: t(ctx, 'registration.role_driver'), callback_data: 'reg:role:driver' }],
            [{ text: t(ctx, 'registration.role_client'), callback_data: 'reg:role:client' }]
        ];

        await ctx.reply(
            t(ctx, 'start.choose_role'),
            { reply_markup: { inline_keyboard: keyboard } }
        );

        user.registrationStep = 'role';
        await user.save();

        return true; // Registration started
    } catch (error) {
        throw error;
    }
};

/**
 * Handle role selection
 */
const handleRoleSelection = async (ctx) => {
    try {
        const role = ctx.callbackQuery.data.split(':')[2]; // 'reg:role:driver' -> 'driver'
        const user = await getOrCreateUser(ctx);

        user.profile.role = role;
        user.registrationStep = 'personal_info';
        await user.save();

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            t(ctx, 'registration.role_selected', { role: t(ctx, `registration.role_${role}`) })
        );

        // Ask for first name
        setTimeout(async () => {
            await ctx.reply(t(ctx, 'registration.enter_first_name'));
        }, 500);

        global.logger.logAction('user_selected_role', {
            userId: user._id,
            role: role
        });
    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Handle registration steps based on current step
 */
const handleRegistrationStep = async (ctx) => {
    try {
        const user = await getOrCreateUser(ctx);
        const messageText = ctx.message.text;

        if (user.registrationCompleted) {
            return false;
        }

        switch (user.registrationStep) {
            case 'personal_info':
            case 'last_name':
            case 'birth_year':
                return await handlePersonalInfo(ctx, user, messageText);
            case 'vehicle_info':
                return await handleVehicleInfo(ctx, user, messageText);
            case 'contact':
                return await handleContactStep(ctx, user);
            default:
                return false;
        }
    } catch (error) {
        throw error;
    }
};

/**
 * Handle personal information collection
 */
const handlePersonalInfo = async (ctx, user, messageText) => {
    try {
        // Use specific sub-steps for personal info
        if (!user.personalInfoStep) user.personalInfoStep = 'first_name';

        if (user.personalInfoStep === 'first_name') {
            user.profile.firstName = messageText.trim();
            user.personalInfoStep = 'last_name';
            await user.save();
            await ctx.reply(t(ctx, 'registration.enter_last_name'));
            return true;
        } else if (user.personalInfoStep === 'last_name') {
            user.profile.lastName = messageText.trim();
            user.personalInfoStep = 'birth_year';
            await user.save();
            await ctx.reply(t(ctx, 'registration.enter_birth_year'));
            return true;
        } else if (user.personalInfoStep === 'birth_year') {
            const year = parseInt(messageText);
            const currentYear = new Date().getFullYear();

            if (isNaN(year) || year < 1900 || year > currentYear - 16) {
                await ctx.reply(t(ctx, 'registration.invalid_year'));
                return true;
            }

            user.profile.birthYear = year;
            user.personalInfoStep = null; // Clear sub-step
            await user.save();

            if (user.isDriver()) {
                user.registrationStep = 'vehicle_info';
                await user.save();
                await ctx.reply(t(ctx, 'registration.enter_vehicle_model'));
            } else {
                user.registrationStep = 'contact';
                await user.save();
                await requestContact(ctx);
            }
            return true;
        }

        return false;
    } catch (error) {
        throw error;
    }
};

/**
 * Handle vehicle information for drivers
 */
const handleVehicleInfo = async (ctx, user, messageText) => {
    try {
        if (!user.driverInfo.vehicleModel) {
            // Collecting vehicle model
            user.driverInfo.vehicleModel = messageText.trim();
            await user.save();

            // Show vehicle category selection
            const keyboard = [
                [{ text: t(ctx, 'registration.vehicle_categories.light'), callback_data: 'reg:vehicle:light' }],
                [{ text: t(ctx, 'registration.vehicle_categories.medium'), callback_data: 'reg:vehicle:medium' }],
                [{ text: t(ctx, 'registration.vehicle_categories.heavy'), callback_data: 'reg:vehicle:heavy' }],
                [{ text: t(ctx, 'registration.vehicle_categories.special'), callback_data: 'reg:vehicle:special' }]
            ];

            await ctx.reply(
                t(ctx, 'registration.choose_vehicle_category'),
                { reply_markup: { inline_keyboard: keyboard } }
            );
            return true;
        } else if (!user.driverInfo.currentLocation) {
            // Collecting current location
            user.driverInfo.currentLocation = messageText.trim();
            user.registrationStep = 'contact';
            await user.save();
            await requestContact(ctx);
            return true;
        }

        return false;
    } catch (error) {
        throw error;
    }
};

/**
 * Handle vehicle category selection
 */
const handleVehicleCategory = async (ctx) => {
    try {
        const category = ctx.callbackQuery.data.split(':')[2]; // 'reg:vehicle:light' -> 'light'
        const user = await getOrCreateUser(ctx);

        user.driverInfo.vehicleCategory = category;
        await user.save();

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            t(ctx, 'registration.choose_vehicle_category') + '\n\n✅ ' +
            t(ctx, `registration.vehicle_categories.${category}`)
        );

        // Ask for current location
        setTimeout(async () => {
            await ctx.reply(t(ctx, 'registration.enter_current_location'));
        }, 500);

        return true;
    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
        throw error;
    }
};

/**
 * Request contact information
 */
const requestContact = async (ctx) => {
    const keyboard = [
        [{ text: t(ctx, 'registration.contact_button'), request_contact: true }]
    ];

    await ctx.reply(
        t(ctx, 'registration.share_contact'),
        {
            reply_markup: {
                keyboard: keyboard,
                resize_keyboard: true,
                one_time_keyboard: true
            }
        }
    );
};

/**
 * Handle contact sharing
 */
const handleContactStep = async (ctx, user) => {
    try {
        if (ctx.message.contact) {
            user.profile.phoneNumber = ctx.message.contact.phone_number;
            user.registrationStep = 'completed';
            user.registrationCompleted = true;
            await user.save();

            // Remove keyboard and show completion message
            await ctx.reply(
                t(ctx, 'start.registration_completed'),
                { reply_markup: { remove_keyboard: true } }
            );

            // Show main menu
            setTimeout(async () => {
                const { getMainMenuKeyboard } = require('./common');
                await ctx.reply(
                    t(ctx, user.isDriver() ? 'menu.main_driver' : 'menu.main_client'),
                    getMainMenuKeyboard(ctx, user)
                );
            }, 1000);

            global.logger.logAction('user_completed_registration', {
                userId: user._id,
                role: user.profile.role,
                hasPhone: !!user.profile.phoneNumber
            });

            return true;
        }

        return false;
    } catch (error) {
        throw error;
    }
};

/**
 * Check if user needs registration
 */
const requireRegistration = async (ctx, next) => {
    try {
        const user = await getOrCreateUser(ctx);

        if (!user.registrationCompleted) {
            await ctx.reply(t(ctx, 'errors.registration_required'));
            await startRegistration(ctx);
            return;
        }

        ctx.user = user; // Add user to context
        return next();
    } catch (error) {
        await ctx.reply(t(ctx, 'errors.general'));
        throw error;
    }
};

module.exports = {
    getOrCreateUser,
    startRegistration,
    handleRoleSelection,
    handleRegistrationStep,
    handleVehicleCategory,
    handleContactStep,
    requireRegistration
};