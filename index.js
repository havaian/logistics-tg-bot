require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const mongoose = require('mongoose');

// Import logger
const { logAction, logUserMessage, logError, logInfo } = require('./logger');

// Import the translation helper
const { t } = require('./utils/i18nHelper');

// Check required environment variables
const requiredEnvVars = ['BOT_TOKEN', 'MONGO_URI'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logError(new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`));
  process.exit(1);
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    logInfo('Connected to MongoDB', { database: process.env.MONGO_URI.split('/').pop() });
  })
  .catch(err => {
    logError(err, { context: 'MongoDB connection failed' });
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
      logUserMessage(ctx.from, ctx.message.text);
    }

    // Log callback queries
    if (ctx.callbackQuery) {
      logAction('callback_query', {
        userId: ctx.from.id,
        username: ctx.from.username,
        data: ctx.callbackQuery.data
      });
    }

    return next();
  } catch (error) {
    logError(error, { context: 'Logging middleware error' });
    return next();
  }
});

// Basic handlers
const handleStart = async (ctx) => {
  try {
    const welcomeMessage = t(ctx, 'start.welcome', { 
      firstName: ctx.from.first_name || ctx.from.username || 'User' 
    });
    
    await ctx.reply(welcomeMessage);
    
    logAction('user_started_bot', {
      userId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      language: ctx.locale
    });
  } catch (error) {
    logError(error, { context: 'Start handler error', userId: ctx.from.id });
    await ctx.reply(t(ctx, 'errors.general'));
  }
};

const handleHelp = async (ctx) => {
  try {
    const helpMessage = t(ctx, 'help.message');
    await ctx.reply(helpMessage);
    
    logAction('user_requested_help', {
      userId: ctx.from.id,
      username: ctx.from.username
    });
  } catch (error) {
    logError(error, { context: 'Help handler error', userId: ctx.from.id });
    await ctx.reply(t(ctx, 'errors.general'));
  }
};

// Language selection handlers
const languageHandlers = require('./handlers/language');

// Command handlers
bot.start(handleStart);
bot.command('help', handleHelp);
bot.command('language', languageHandlers.handleLanguageSelection);

// Language callback handler
bot.action(/lang:(.+)/, languageHandlers.handleLanguageChange);

// Basic message handler
bot.on('message', async (ctx, next) => {
  try {
    // Skip if no text
    if (!ctx.message.text) return next();

    const messageText = ctx.message.text;

    // Skip command messages
    if (messageText.startsWith('/')) {
      return next();
    }

    // Handle language button
    if (messageText === '🌐 Language') {
      return languageHandlers.handleLanguageSelection(ctx);
    }

    // Add your custom message handlers here
    // Example:
    // if (messageText === 'Some button text') {
    //   return handleSomeAction(ctx);
    // }

    // Default response for unhandled messages
    const defaultResponse = t(ctx, 'messages.default_response');
    await ctx.reply(defaultResponse);

  } catch (error) {
    logError(error, { context: 'Message handler error', userId: ctx.from.id });
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

  logError(err, errorContext);

  // Try to respond to user when error occurs
  try {
    // Use translated error message
    ctx.reply(t(ctx, 'errors.general'));
  } catch (replyErr) {
    logError(replyErr, { context: 'Error sending error message to user' });
    // Fallback to hardcoded message if translation fails
    try {
      ctx.reply('An error occurred while processing your request. Please try again later.');
    } catch (finalErr) {
      logError(finalErr, { context: 'Final error fallback failed' });
    }
  }
});

// Graceful shutdown handlers
const gracefulShutdown = (signal) => {
  logInfo(`Bot shutting down due to ${signal}...`);

  bot.stop(signal)
    .then(() => {
      logInfo(`Bot stopped successfully (${signal})`);
      process.exit(0);
    })
    .catch((err) => {
      logError(err, { context: `Error stopping bot on ${signal}` });
      process.exit(1);
    });
};

// Launch bot
bot.launch()
  .then(() => {
    logInfo('Bot started successfully', {
      nodeEnv: process.env.NODE_ENV || 'production',
      pid: process.pid
    });
  })
  .catch(err => {
    logError(err, { context: 'Bot startup failed' });
    process.exit(1);
  });

// Enable graceful stop
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));