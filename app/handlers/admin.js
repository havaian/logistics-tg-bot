const { t } = require('../utils/i18nHelper');
const { logAction } = require('../logger');
const groupsHandler = require('./groups');

// List of admin user IDs (add your admin Telegram IDs here)
const ADMIN_USER_IDS = [
    // 123456789, // Add your admin Telegram ID here
];

/**
 * Check if user is admin
 */
const isAdmin = (userId) => {
    return ADMIN_USER_IDS.includes(userId);
};

/**
 * Admin middleware
 */
const requireAdmin = (ctx, next) => {
    if (!isAdmin(ctx.from.id)) {
        ctx.reply(t(ctx, 'admin.access_denied'));
        return;
    }
    return next();
};

/**
 * Show admin menu
 */
const showAdminMenu = async (ctx) => {
    try {
        const keyboard = [
            [
                { text: t(ctx, 'admin.groups_list'), callback_data: 'admin:groups:list' },
                { text: t(ctx, 'admin.add_group'), callback_data: 'admin:groups:add' }
            ],
            [
                { text: t(ctx, 'admin.groups_settings'), callback_data: 'admin:groups:settings' },
                { text: t(ctx, 'admin.reload_config'), callback_data: 'admin:groups:reload' }
            ],
            [
                { text: t(ctx, 'admin.statistics'), callback_data: 'admin:stats' }
            ]
        ];

        await ctx.reply(
            t(ctx, 'admin.panel_title'),
            { reply_markup: { inline_keyboard: keyboard } }
        );

        logAction('admin_menu_accessed', {
            adminId: ctx.from.id,
            username: ctx.from.username
        });

    } catch (error) {
        await ctx.reply(t(ctx, 'admin.error_menu'));
        throw error;
    }
};

/**
 * Show groups list
 */
const showGroupsList = async (ctx) => {
    try {
        const groups = groupsHandler.getGroupsList();

        if (groups.length === 0) {
            await ctx.answerCbQuery();
            await ctx.editMessageText(
                t(ctx, 'admin.no_groups_configured'),
                { reply_markup: { inline_keyboard: [[{ text: t(ctx, 'buttons.back'), callback_data: 'admin:menu' }]] } }
            );
            return;
        }

        let message = t(ctx, 'admin.configured_groups');

        groups.forEach((group, index) => {
            const status = group.active ? t(ctx, 'admin.group_status_active') : t(ctx, 'admin.group_status_inactive');
            message += `${index + 1}. ${status} ${group.name}\n`;
            message += `   ${t(ctx, 'admin.group_region', { region: group.region || t(ctx, 'buttons.all_regions') })}\n`;
            message += `   ${t(ctx, 'admin.group_id', { id: group.id })}\n`;
            if (group.description) {
                message += `   ${t(ctx, 'admin.group_description', { description: group.description })}\n`;
            }
            message += '\n';
        });

        const keyboard = [
            [
                { text: t(ctx, 'admin.add_group'), callback_data: 'admin:groups:add' },
                { text: t(ctx, 'buttons.reload'), callback_data: 'admin:groups:reload' }
            ],
            [{ text: t(ctx, 'buttons.back'), callback_data: 'admin:menu' }]
        ];

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            message,
            { reply_markup: { inline_keyboard: keyboard } }
        );

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'admin.error_loading_groups'));
        throw error;
    }
};

/**
 * Show groups settings
 */
const showGroupsSettings = async (ctx) => {
    try {
        const settings = groupsHandler.getGroupsSettings();

        let message = t(ctx, 'admin.settings_title');
        message += t(ctx, 'admin.auto_posting', {
            status: settings.auto_posting_enabled ? t(ctx, 'buttons.enabled') : t(ctx, 'buttons.disabled')
        }) + '\n';
        message += t(ctx, 'admin.max_groups_per_order', { count: settings.max_groups_per_order || 3 }) + '\n';
        message += t(ctx, 'admin.posting_delay', { delay: settings.posting_delay_ms || 1000 }) + '\n';
        message += t(ctx, 'admin.retry_failed_posts', {
            status: settings.retry_failed_posts ? t(ctx, 'buttons.enabled') : t(ctx, 'buttons.disabled')
        }) + '\n';

        const keyboard = [
            [
                {
                    text: settings.auto_posting_enabled ? t(ctx, 'admin.disable_auto_posting') : t(ctx, 'admin.enable_auto_posting'),
                    callback_data: 'admin:settings:toggle_posting'
                }
            ],
            [{ text: t(ctx, 'buttons.back'), callback_data: 'admin:menu' }]
        ];

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            message,
            { reply_markup: { inline_keyboard: keyboard } }
        );

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'admin.error_loading_settings'));
        throw error;
    }
};

/**
 * Toggle auto posting setting
 */
const toggleAutoPosting = async (ctx) => {
    try {
        const settings = groupsHandler.getGroupsSettings();
        const newValue = !settings.auto_posting_enabled;

        groupsHandler.updateGroupsSettings({
            auto_posting_enabled: newValue
        });

        const statusMessage = newValue ? t(ctx, 'admin.auto_posting_enabled') : t(ctx, 'admin.auto_posting_disabled');
        await ctx.answerCbQuery(statusMessage);
        await showGroupsSettings(ctx);

        logAction('admin_toggled_auto_posting', {
            adminId: ctx.from.id,
            newValue: newValue
        });

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'admin.error_updating_setting'));
        throw error;
    }
};

/**
 * Reload groups configuration
 */
const reloadGroupsConfig = async (ctx) => {
    try {
        const result = groupsHandler.reloadGroupsConfig();

        const message = t(ctx, 'admin.config_reloaded', {
            groupsCount: result.groupsCount,
            activeGroups: result.activeGroups
        });
        await ctx.answerCbQuery(message);
        await showGroupsList(ctx);

        logAction('admin_reloaded_groups_config', {
            adminId: ctx.from.id,
            groupsCount: result.groupsCount,
            activeGroups: result.activeGroups
        });

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'admin.error_reloading_config'));
        throw error;
    }
};

/**
 * Start add group process
 */
const startAddGroup = async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            t(ctx, 'admin.add_group_instructions'),
            { reply_markup: { inline_keyboard: [[{ text: t(ctx, 'buttons.back'), callback_data: 'admin:groups:list' }]] } }
        );

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'admin.error_add_group'));
        throw error;
    }
};

/**
 * Show basic statistics
 */
const showStatistics = async (ctx) => {
    try {
        const User = require('../models/user');
        const Order = require('../models/order');

        // Get basic stats
        const totalUsers = await User.countDocuments();
        const totalDrivers = await User.countDocuments({ 'profile.role': 'driver' });
        const totalClients = await User.countDocuments({ 'profile.role': 'client' });
        const registeredUsers = await User.countDocuments({ registrationCompleted: true });

        const totalOrders = await Order.countDocuments();
        const activeOrders = await Order.countDocuments({ status: 'active' });
        const completedOrders = await Order.countDocuments({ status: 'completed' });

        const groups = groupsHandler.getGroupsList();
        const activeGroups = groups.filter(g => g.active).length;

        let message = t(ctx, 'admin.stats_title');
        message += t(ctx, 'admin.stats_users') + '\n';
        message += `   ${t(ctx, 'admin.stats_total', { count: totalUsers })}\n`;
        message += `   ${t(ctx, 'admin.stats_registered', { count: registeredUsers })}\n`;
        message += `   ${t(ctx, 'admin.stats_drivers', { count: totalDrivers })}\n`;
        message += `   ${t(ctx, 'admin.stats_clients', { count: totalClients })}\n\n`;

        message += t(ctx, 'admin.stats_orders') + '\n';
        message += `   ${t(ctx, 'admin.stats_total', { count: totalOrders })}\n`;
        message += `   ${t(ctx, 'admin.stats_active', { count: activeOrders })}\n`;
        message += `   ${t(ctx, 'admin.stats_completed', { count: completedOrders })}\n\n`;

        message += t(ctx, 'admin.stats_groups') + '\n';
        message += `   ${t(ctx, 'admin.stats_total', { count: groups.length })}\n`;
        message += `   ${t(ctx, 'admin.stats_active_groups', { count: activeGroups })}\n`;

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            message,
            { reply_markup: { inline_keyboard: [[{ text: t(ctx, 'buttons.back'), callback_data: 'admin:menu' }]] } }
        );

        logAction('admin_viewed_statistics', {
            adminId: ctx.from.id
        });

    } catch (error) {
        await ctx.answerCbQuery(t(ctx, 'admin.error_loading_stats'));
        throw error;
    }
};

/**
 * Handle admin commands
 */
const handleAdminCommand = async (ctx) => {
    try {
        const command = ctx.message.text.toLowerCase().trim();

        if (command === '/admin') {
            return showAdminMenu(ctx);
        }

        // Handle addgroup command: /addgroup -1001234567890 "Group Name" "region"
        if (command.startsWith('/addgroup ')) {
            const parts = command.match(/\/addgroup\s+(-?\d+)\s+"([^"]+)"\s+"([^"]+)"/);
            if (!parts) {
                await ctx.reply(t(ctx, 'admin.addgroup_invalid_format'));
                return;
            }

            const [, groupId, groupName, region] = parts;
            const success = groupsHandler.addGroup(parseInt(groupId), groupName, region, '', true);

            if (success) {
                const successMessage = t(ctx, 'admin.group_added_success', {
                    groupName: groupName,
                    region: region,
                    groupId: groupId
                });
                await ctx.reply(successMessage);

                logAction('admin_added_group', {
                    adminId: ctx.from.id,
                    groupId: parseInt(groupId),
                    groupName: groupName,
                    region: region
                });
            } else {
                await ctx.reply(t(ctx, 'admin.error_adding_group'));
            }
            return;
        }

    } catch (error) {
        await ctx.reply(t(ctx, 'admin.error_processing_command'));
        throw error;
    }
};

module.exports = {
    isAdmin,
    requireAdmin,
    showAdminMenu,
    showGroupsList,
    showGroupsSettings,
    toggleAutoPosting,
    reloadGroupsConfig,
    startAddGroup,
    showStatistics,
    handleAdminCommand
};