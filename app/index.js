require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const mongoose = require('mongoose');

// Import logger
require('./logger');

// Import Redis service
const redisService = require('./services/redisService');

// Import the translation helper
require('./utils/i18nHelper');

// Import all handlers
const registrationHandlers = require('./handlers/registration');
const orderHandlers = require('./handlers/orders');
const profileHandlers = require('./handlers/profile');
const languageHandlers = require('./handlers/language');
const groupHandlers = require('./handlers/groups');
const matchingHandlers = require('./handlers/matching');
const adminHandlers = require('./handlers/admin');
const keyboardMenus = require('./handlers/keyboardMenus');

// Import middleware
const { userStateMiddleware, resetUserState } = require('./middleware/userStateMiddleware');

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

// Connect to Redis
const initializeRedis = async () => {
    try {
        const connected = await redisService.connect();
        if (!connected) {
            global.logger.logError('Failed to connect to Redis - continuing without Redis state management');
        }
    } catch (error) {
        global.logger.logError('Redis initialization error:', error);
    }
};

// Setup middleware
bot.use(session());

// Language detection middleware
const { detectUserLanguage } = require('./i18n/middleware');
bot.use(detectUserLanguage);

// Enhanced logging middleware
bot.use(async (ctx, next) => {
    try {
        if (ctx.message && ctx.message.text) {
            // Log user message with state if available from middleware
            global.logger.logUserMessage(ctx.from, ctx.message.text, ctx.userState);
        }

        // Log callback queries
        if (ctx.callbackQuery) {
            global.logger.logAction('callback_query', {
                userId: ctx.from.id,
                username: ctx.from.username,
                data: ctx.callbackQuery.data,
                userState: ctx.userState?.current
            });
        }

        return next();
    } catch (error) {
        global.logger.logError(error, ctx, { context: 'Logging middleware error' });
        return next();
    }
});

// User middleware for protected routes (simplified)
const userMiddleware = async (ctx, next) => {
    try {
        if (!ctx.user) {
            const User = require('./models/user');
            const user = await User.findByTelegramId(ctx.from.id);
            ctx.user = user;
        }
        return next();
    } catch (error) {
        global.logger.logError(error, ctx, { context: 'User middleware error' });
        await ctx.reply(global.i18n.t(ctx, 'errors.general'));
    }
};

// State management middleware
bot.use(userStateMiddleware);

// ==================== Command Handlers ====================

// Start handler
const handleStart = async (ctx) => {
    try {
        const user = ctx.user;

        // If user is already registered, show main menu
        if (user && user.registrationCompleted) {
            await keyboardMenus.showMainMenu(ctx, user, global.i18n.t(ctx, 'start.welcome_back'));
            return;
        }

        // Start registration for new users
        await ctx.reply(
            global.i18n.t(ctx, 'start.welcome'),
            { reply_markup: { remove_keyboard: true } }
        );

        // The state middleware will handle the registration flow
        global.logger.logAction('user_started_bot', {
            userId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            language: ctx.locale,
            isNewUser: !user || !user.registrationCompleted
        });
    } catch (error) {
        global.logger.logError(error, ctx, { context: 'Start handler error', userId: ctx.from.id });
        await ctx.reply(global.i18n.t(ctx, 'errors.general'));
    }
};

// Help handler
const handleHelp = async (ctx) => {
    try {
        const helpMessage = global.i18n.t(ctx, 'help.message');
        await ctx.reply(helpMessage);

        global.logger.logAction('user_requested_help', {
            userId: ctx.from.id,
            username: ctx.from.username
        });
    } catch (error) {
        global.logger.logError(error, ctx, { context: 'Help handler error', userId: ctx.from.id });
        await ctx.reply(global.i18n.t(ctx, 'errors.general'));
    }
};

// ==================== Bot Commands ====================

bot.start(handleStart);
bot.command('help', handleHelp);
bot.command('reset', async (ctx) => {
    await resetUserState(ctx.from.id);
    await ctx.reply('🔄 Your state has been reset. Send /start to begin registration again.');
});
bot.command('menu', userMiddleware, async (ctx) => {
    if (ctx.user && ctx.user.registrationCompleted) {
        await keyboardMenus.showMainMenu(ctx, ctx.user);
    } else {
        await ctx.reply(global.i18n.t(ctx, 'errors.registration_required'));
    }
});

// Admin commands
bot.command('admin', adminHandlers.requireAdmin, adminHandlers.showAdminMenu);
bot.command('addgroup', adminHandlers.requireAdmin, adminHandlers.handleAdminCommand);

// ==================== Inline Callback Handlers (Group Posts Only) ====================

// Group callback handlers (keep these for channel posts)
bot.action(/group:interest:(.+)/, groupHandlers.handleGroupInterest);
bot.action(/group:contact:(.+)/, groupHandlers.handleGroupContact);

// Admin callback handlers
bot.action('admin:groups', adminHandlers.requireAdmin, adminHandlers.showGroupsManagement);
bot.action('admin:groups:add', adminHandlers.requireAdmin, adminHandlers.startAddGroup);
bot.action('admin:groups:reload', adminHandlers.requireAdmin, adminHandlers.reloadGroupsConfig);
bot.action('admin:settings:toggle_posting', adminHandlers.requireAdmin, adminHandlers.toggleAutoPosting);
bot.action('admin:stats', adminHandlers.requireAdmin, adminHandlers.showStatistics);

// ==================== Message Handlers ====================

// Contact message handler (for registration)
bot.on('contact', async (ctx) => {
    // The state middleware will handle this during registration
    return;
});

// Text message handler
bot.on('message', async (ctx, next) => {
    try {
        // Skip if no text
        if (!ctx.message.text) return next();

        const messageText = ctx.message.text;
        const user = ctx.user;

        // Handle keyboard menu selections for registered users
        if (user && user.registrationCompleted) {
            const handled = await keyboardMenus.handleKeyboardMenu(ctx);
            if (handled) return;
        }

        // Handle admin commands
        if (messageText.startsWith('/admin_') && user) {
            return await adminHandlers.handleAdminCommand(ctx, next);
        }

        // Handle registration steps (handled by state middleware)
        // If we reach here, the message wasn't handled by state or menu handlers

        // Check if it's a valid menu item but user isn't registered
        if (keyboardMenus.isKeyboardMenuItem(messageText, ctx)) {
            await ctx.reply(global.i18n.t(ctx, 'errors.registration_required'));
            return;
        }

        // Default response for unrecognized messages
        if (user && user.registrationCompleted) {
            await ctx.reply(
                global.i18n.t(ctx, 'errors.unknown_command'),
                { reply_markup: keyboardMenus.getMainMenuKeyboard(ctx, user) }
            );
        }

    } catch (error) {
        global.logger.logError(error, ctx, { context: 'Message handler error' });
        await ctx.reply(global.i18n.t(ctx, 'errors.general'));
    }
});

// ==================== Error Handling ====================

bot.catch((err, ctx) => {
    global.logger.logError('Bot error:', ctx, err);

    if (ctx && ctx.reply) {
        ctx.reply(global.i18n.t(ctx, 'errors.general')).catch(() => {
            // Ignore reply errors
        });
    }
});

// ==================== Graceful Shutdown ====================

process.once('SIGINT', async () => {
    global.logger.logInfo('Received SIGINT. Graceful shutdown...');

    try {
        await bot.stop('SIGINT');
        await redisService.disconnect();
        await mongoose.connection.close();
        global.logger.logInfo('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        global.logger.logError('Error during shutdown:', {}, error);
        process.exit(1);
    }
});

process.once('SIGTERM', async () => {
    global.logger.logInfo('Received SIGTERM. Graceful shutdown...');

    try {
        await bot.stop('SIGTERM');
        await redisService.disconnect();
        await mongoose.connection.close();
        global.logger.logInfo('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        global.logger.logError('Error during shutdown:', {}, error);
        process.exit(1);
    }
});

// ==================== Bot Launch ====================

const launchBot = async () => {
    try {
        // Initialize Redis first
        await initializeRedis();

        // Launch bot
        await bot.launch();
        global.logger.logInfo('🤖 Bot started successfully');

        // Enable graceful stop
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));

    } catch (error) {
        global.logger.logError('Failed to launch bot:', error);
        process.exit(1);
    }
};

// Start the bot
launchBot();