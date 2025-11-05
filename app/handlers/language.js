const { getOrCreateUser, isGroupChat } = require('./common');
const { t } = require('../utils/');

/**
 * Handle /language command - show language selection
 */
const handleLanguageSelection = async (ctx) => {
    try {
        // Don't allow language selection in group chats
        if (isGroupChat(ctx)) {
            await ctx.reply('Смена языка доступна только в личных сообщениях.');
            return;
        }

        const keyboard = [
            [{ text: '🇷🇺 Русский', callback_data: 'lang:ru' }],
            [{ text: '🇺🇿 O\'zbek', callback_data: 'lang:uz' }],
            [{ text: '🇺🇸 English', callback_data: 'lang:en' }]
        ];

        await ctx.reply(
            global.i18n.t(ctx, 'language.select'),
            { reply_markup: { inline_keyboard: keyboard } }
        );
    } catch (error) {
        global.logger.logError('Error handling language selection:', ctx, error);
        await ctx.reply(global.i18n.t(ctx, 'errors.general'));
    }
};

/**
 * Handle language change callback
 */
const handleLanguageChange = async (ctx) => {
    try {
        const locale = ctx.callbackQuery.data.split(':')[1];
        const user = await getOrCreateUser(ctx);

        // Update user language
        user.language = locale;
        await user.save();

        // Update current context
        ctx.locale = locale;

        const { getMainMenuKeyboard, getStudentMenuKeyboard, isStudent } = require('./common');

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            global.i18n.t(ctx, 'language.changed'),
            { reply_markup: { inline_keyboard: [] } }
        );

        // Send updated keyboard based on user role (only in private chat)
        if (!isGroupChat(ctx)) {
            if (isStudent(user)) {
                await ctx.reply(global.i18n.t(ctx, 'lists.select_action'), getStudentMenuKeyboard(ctx));
            } else {
                await ctx.reply(global.i18n.t(ctx, 'lists.select_action'), getMainMenuKeyboard(ctx));
            }
        }

        global.logger.logAction('user_changed_language', {
            userId: user._id,
            newLanguage: locale
        });
    } catch (error) {
        global.logger.logError('Error handling language change:', ctx, error);
        await ctx.answerCbQuery(global.i18n.t(ctx, 'errors.general'));
    }
};

module.exports = {
    handleLanguageSelection,
    handleLanguageChange
};