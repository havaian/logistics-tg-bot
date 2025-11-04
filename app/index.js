require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const mongoose = require('mongoose');

// Import logger
require('./logger');

// Import the translation helper
const { t } = require('./utils/i18nHelper');

// Import all handlers
const registrationHandlers = require('./handlers/registration');
const orderHandlers = require('./handlers/orders');
const profileHandlers = require('./handlers/profile');
const languageHandlers = require('./handlers/language');
const groupHandlers = require('./handlers/groups');
const matchingHandlers = require('./handlers/matching');
const adminHandlers = require('./handlers/admin');

// Check required environment variables
const requiredEnvVars = ['BOT_TOKEN', 'MONGO_URI'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    global.logger.logError(new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`));
    process.exit(1);
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        global.logger.logInfo('✅ MongoDB', { database: process.env.MONGO_URI.split('/').pop() });
    })
    .catch(err => {
        global.logger.logError(err, { context: 'MongoDB connection failed' });
        process.exit(1);
    });

// Setup middleware
bot.use(session());

// Language detection middleware
const { detectUserLanguage } = require('./i18n/middleware');
bot.use(detectUserLanguage);

// Enhanced logging middleware
bot.use(async (ctx, next) => {
    try {
        if (ctx.message && ctx.message.text) {
            global.logger.logUserMessage(ctx.from, ctx.message.text);
        }

        // Log callback queries
        if (ctx.callbackQuery) {
            global.logger.logAction('callback_query', {
                userId: ctx.from.id,
                username: ctx.from.username,
                data: ctx.callbackQuery.data
            });
        }

        return next();
    } catch (error) {
        global.logger.logError(error, { context: 'Logging middleware error' });
        return next();
    }
});

// User registration middleware for protected routes
const userMiddleware = async (ctx, next) => {
    try {
        const user = await registrationHandlers.getOrCreateUser(ctx);
        ctx.user = user;
        return next();
    } catch (error) {
        global.logger.logError(error, { context: 'User middleware error' });
        await ctx.reply(t(ctx, 'errors.general'));
    }
};

// Start handler with registration
const handleStart = async (ctx) => {
    try {
        await userMiddleware(ctx, async () => {
            const user = ctx.user;

            // Check if user needs registration
            if (!user.registrationCompleted) {
                const registrationStarted = await registrationHandlers.startRegistration(ctx);
                if (registrationStarted) {
                    return;
                }
            }

            // Show welcome message and main menu for registered users
            const welcomeMessage = t(ctx, 'start.welcome');
            const { getMainMenuKeyboard } = require('./handlers/common');

            await ctx.reply(
                welcomeMessage,
                getMainMenuKeyboard(ctx, user)
            );

            global.logger.logAction('user_started_bot', {
                userId: ctx.from.id,
                username: ctx.from.username,
                firstName: ctx.from.first_name,
                language: ctx.locale,
                registrationCompleted: user.registrationCompleted
            });
        });
    } catch (error) {
        global.logger.logError(error, { context: 'Start handler error', userId: ctx.from.id });
        await ctx.reply(t(ctx, 'errors.general'));
    }
};

const handleHelp = async (ctx) => {
    try {
        const helpMessage = t(ctx, 'help.message');
        await ctx.reply(helpMessage);

        global.logger.logAction('user_requested_help', {
            userId: ctx.from.id,
            username: ctx.from.username
        });
    } catch (error) {
        global.logger.logError(error, { context: 'Help handler error', userId: ctx.from.id });
        await ctx.reply(t(ctx, 'errors.general'));
    }
};

// Command handlers
bot.start(handleStart);
bot.command('help', handleHelp);
bot.command('language', languageHandlers.handleLanguageSelection);
bot.command('profile', userMiddleware, registrationHandlers.requireRegistration, profileHandlers.showProfile);

// Admin commands
bot.command('admin', adminHandlers.requireAdmin, adminHandlers.showAdminMenu);
bot.command('addgroup', adminHandlers.requireAdmin, adminHandlers.handleAdminCommand);

// Registration callback handlers
bot.action(/reg:role:(.+)/, userMiddleware, registrationHandlers.handleRoleSelection);
bot.action(/reg:vehicle:(.+)/, userMiddleware, registrationHandlers.handleVehicleCategory);

// Menu callback handlers
bot.action('menu:main', userMiddleware, async (ctx) => {
    try {
        const user = ctx.user;
        const { getMainMenuKeyboard } = require('./handlers/common');

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            t(ctx, user.isDriver() ? 'menu.main_driver' : 'menu.main_client'),
            getMainMenuKeyboard(ctx, user)
        );
    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'errors.general'));
    }
});

// Driver menu handlers
bot.action('driver:find_orders', userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    return orderHandlers.findOrdersForDriver(ctx, 1);
});

bot.action(/driver:find_orders:(\d+)/, userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    const page = parseInt(ctx.match[1]);
    return orderHandlers.findOrdersForDriver(ctx, page);
});

bot.action('driver:my_orders', userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    return profileHandlers.showMyOrders(ctx, 1);
});

// Client menu handlers
bot.action('client:create_order', userMiddleware, registrationHandlers.requireRegistration, orderHandlers.startOrderCreation);
bot.action('client:my_orders', userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    return profileHandlers.showMyOrders(ctx, 1);
});

// Order management handlers
bot.action(/order:view:(.+)/, userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    const orderId = ctx.match[1];
    return orderHandlers.viewOrderDetails(ctx, orderId);
});

bot.action(/order:interest:(.+)/, userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    const orderId = ctx.match[1];
    return orderHandlers.showInterestInOrder(ctx, orderId);
});

bot.action('order:skip', userMiddleware, (ctx) => {
    return orderHandlers.handleOrderCreationStep(ctx);
});

bot.action('order:confirm', userMiddleware, orderHandlers.confirmOrder);
bot.action('order:cancel', userMiddleware, orderHandlers.cancelOrderCreation);

// My orders handlers
bot.action(/myorders:(\d+)/, userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    const page = parseInt(ctx.match[1]);
    return profileHandlers.showMyOrders(ctx, page);
});

bot.action(/myorder:view:(.+)/, userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    const orderId = ctx.match[1];
    return profileHandlers.viewMyOrder(ctx, orderId);
});

bot.action(/myorder:drivers:(.+)/, userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    const orderId = ctx.match[1];
    return profileHandlers.showInterestedDrivers(ctx, orderId);
});

bot.action(/myorder:select:(.+):(.+)/, userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    const orderId = ctx.match[1];
    const driverId = ctx.match[2];
    return profileHandlers.selectDriverForOrder(ctx, orderId, driverId);
});

bot.action(/myorder:complete:(.+)/, userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    const orderId = ctx.match[1];
    return profileHandlers.completeOrder(ctx, orderId);
});

bot.action(/myorder:cancel:(.+)/, userMiddleware, registrationHandlers.requireRegistration, (ctx) => {
    const orderId = ctx.match[1];
    return profileHandlers.cancelOrder(ctx, orderId);
});

// Profile handlers
bot.action('profile:view', userMiddleware, registrationHandlers.requireRegistration, profileHandlers.showProfile);
bot.action('profile:edit_location', userMiddleware, registrationHandlers.requireRegistration, profileHandlers.startLocationEdit);

// Admin callback handlers
bot.action('admin:menu', adminHandlers.requireAdmin, adminHandlers.showAdminMenu);
bot.action('admin:groups:list', adminHandlers.requireAdmin, adminHandlers.showGroupsList);
bot.action('admin:groups:settings', adminHandlers.requireAdmin, adminHandlers.showGroupsSettings);
bot.action('admin:groups:add', adminHandlers.requireAdmin, adminHandlers.startAddGroup);
bot.action('admin:groups:reload', adminHandlers.requireAdmin, adminHandlers.reloadGroupsConfig);
bot.action('admin:settings:toggle_posting', adminHandlers.requireAdmin, adminHandlers.toggleAutoPosting);
bot.action('admin:stats', adminHandlers.requireAdmin, adminHandlers.showStatistics);

// Group callback handlers
bot.action(/group:interest:(.+)/, groupHandlers.handleGroupInterest);
bot.action(/group:contact:(.+)/, groupHandlers.handleGroupContact);

// Language callback handler
bot.action(/lang:(.+)/, languageHandlers.handleLanguageChange);

// Settings handlers (placeholder)
bot.action('settings:main', userMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
        '⚙️ Настройки\n\nВ разработке...',
        { reply_markup: { inline_keyboard: [[{ text: t(ctx, 'buttons.back'), callback_data: 'menu:main' }]] } }
    );
});

// Help handler
bot.action('help:main', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
        t(ctx, 'help.message'),
        { reply_markup: { inline_keyboard: [[{ text: t(ctx, 'buttons.back'), callback_data: 'menu:main' }]] } }
    );
});

// Contact message handler
bot.on('contact', userMiddleware, async (ctx) => {
    try {
        const user = ctx.user;
        if (user.registrationStep === 'contact') {
            return await registrationHandlers.handleContactStep(ctx, user);
        }
    } catch (error) {
        global.logger.logError(error, { context: 'Contact handler error' });
    }
});

// Message handler for registration, admin commands, and other text inputs
bot.on('message', userMiddleware, async (ctx, next) => {
    try {
        // Skip if no text
        if (!ctx.message.text) return next();

        const messageText = ctx.message.text;
        const user = ctx.user;

        // Handle admin commands first
        if (messageText.startsWith('/admin') || messageText.startsWith('/addgroup')) {
            if (adminHandlers.isAdmin(ctx.from.id)) {
                return await adminHandlers.handleAdminCommand(ctx);
            }
        }

        // Skip other command messages
        if (messageText.startsWith('/')) {
            return next();
        }

        // Handle registration steps
        if (!user.registrationCompleted) {
            const handled = await registrationHandlers.handleRegistrationStep(ctx);
            if (handled) return;
        }

        // Handle order creation steps
        const orderHandled = await orderHandlers.handleOrderCreationStep(ctx);
        if (orderHandled) return;

        // Handle profile editing
        if (user.tempState === 'editing_location') {
            const handled = await profileHandlers.handleLocationUpdate(ctx);
            if (handled) return;
        }

        // Handle language button
        if (messageText === '🌐 Language') {
            return languageHandlers.handleLanguageSelection(ctx);
        }

        // Default response for unhandled messages (only for registered users)
        if (user.registrationCompleted) {
            const { getMainMenuKeyboard } = require('./handlers/common');
            await ctx.reply(
                'Используйте кнопки меню для навигации:',
                getMainMenuKeyboard(ctx, user)
            );
        }

    } catch (error) {
        global.logger.logError(error, { context: 'Message handler error', userId: ctx.from.id });
        return next();
    }
});

// Enhanced error handling
bot.catch((err, ctx) => {
    const errorContext = {
        updateType: ctx.updateType,
        userId: ctx.from ? ctx.from.id : null,
        username: ctx.from ? ctx.from.username : null,
        chatId: ctx.chat ? ctx.chat.id : null,
        messageId: ctx.message ? ctx.message.message_id : null
    };

    global.logger.logError(err, errorContext);

    // Try to respond to user when error occurs
    try {
        // Use translated error message
        if (ctx.answerCbQuery) {
            ctx.answerCbQuery(t(ctx, 'errors.general'));
        } else {
            ctx.reply(t(ctx, 'errors.general'));
        }
    } catch (replyErr) {
        global.logger.logError(replyErr, { context: 'Error sending error message to user' });
        // Fallback to hardcoded message if translation fails
        try {
            if (ctx.answerCbQuery) {
                ctx.answerCbQuery('An error occurred. Please try again later.');
            } else {
                ctx.reply('An error occurred while processing your request. Please try again later.');
            }
        } catch (finalErr) {
            global.logger.logError(finalErr, { context: 'Final error fallback failed' });
        }
    }
});

// Graceful shutdown handlers
const gracefulShutdown = (signal) => {
    global.logger.logInfo(`Bot shutting down due to ${signal}...`);

    bot.stop(signal)
        .then(() => {
            global.logger.logInfo(`Bot stopped successfully (${signal})`);
            process.exit(0);
        })
        .catch((err) => {
            global.logger.logError(err, { context: `Error stopping bot on ${signal}` });
            process.exit(1);
        });
};

// Launch bot
bot.launch()
    .then(() => {
        global.logger.logInfo('Bot started successfully', {
            nodeEnv: process.env.NODE_ENV || 'production',
            pid: process.pid,
            botUsername: process.env.BOT_USERNAME || 'unknown'
        });
    })
    .catch(err => {
        global.logger.logError(err, { context: 'Bot startup failed' });
        process.exit(1);
    });

// Enable graceful stop
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));