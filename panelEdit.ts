import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  EmbedBuilder,
} from "discord.js";
import { db } from "@workspace/db";
import {
  ticketPanels,
  panelSupportRoles,
  panelTicketRoles,
  panelQuestions,
  panelQuestionChoices,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { buildTicketButton } from "./ticket";

interface EditSession {
  panelId: number;
  lastActivity: number;
  addingQuestionType?: "text" | "choice";
}

const editSessions = new Map<string, EditSession>();

function sessionKey(userId: string, guildId: string) {
  return `${userId}:${guildId}`;
}

function setEditSession(userId: string, guildId: string, s: EditSession) {
  s.lastActivity = Date.now();
  editSessions.set(sessionKey(userId, guildId), s);
}

function getEditSession(userId: string, guildId: string) {
  return editSessions.get(sessionKey(userId, guildId));
}

export async function handlePanelEditAutocomplete(interaction: AutocompleteInteraction) {
  const guildId = interaction.guildId!;
  const focused = interaction.options.getFocused().toLowerCase();

  const panels = await db.select()
    .from(ticketPanels)
    .where(eq(ticketPanels.guildId, guildId));

  const filtered = panels
    .filter((p) => p.title.toLowerCase().includes(focused))
    .slice(0, 25);

  await interaction.respond(
    filtered.map((p) => ({ name: p.title, value: String(p.id) }))
  );
}

async function sendEditMenu(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
  panelId: number,
  userId: string
) {
  const panel = await db.query.ticketPanels.findFirst({
    where: eq(ticketPanels.id, panelId),
  });

  if (!panel) {
    const reply = { content: "Panel not found.", ephemeral: true };
    if ('replied' in interaction && (interaction.replied || interaction.deferred)) {
      await (interaction as ChatInputCommandInteraction).followUp(reply);
    } else {
      await (interaction as ChatInputCommandInteraction).reply(reply);
    }
    return;
  }

  const supportRoles = await db.select().from(panelSupportRoles).where(eq(panelSupportRoles.panelId, panelId));
  const ticketRoles = await db.select().from(panelTicketRoles).where(eq(panelTicketRoles.panelId, panelId));
  const questions = await db.select().from(panelQuestions).where(eq(panelQuestions.panelId, panelId));

  const lines = [
    `**Title:** ${panel.title}`,
    `**Description:** ${panel.description}`,
    `**Button:** ${panel.buttonEmoji ? `${panel.buttonEmoji} ` : ""}${panel.buttonName}`,
    `**Category:** <#${panel.categoryId}>`,
    `**Support Roles:** ${supportRoles.length > 0 ? supportRoles.map((r) => `<@&${r.roleId}>`).join(", ") : "*(none)*"}`,
    `**Ticket Roles:** ${ticketRoles.length > 0 ? ticketRoles.map((r) => `<@&${r.roleId}>`).join(", ") : "*(anyone)*"}`,
    `**Questions:** ${questions.length}`,
  ];

  const embed = new EmbedBuilder()
    .setTitle(`✏️ Editing: ${panel.title}`)
    .setDescription(lines.join("\n"))
    .setColor(0xfee75c)
    .setFooter({ text: `Panel ID: ${panel.id}` });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`edit:basic:${userId}:${panelId}`)
      .setLabel("Edit Title/Description/Button")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`edit:category:${userId}:${panelId}`)
      .setLabel("Change Category")
      .setEmoji("📁")
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`edit:support_roles:${userId}:${panelId}`)
      .setLabel("Reset Support Roles")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`edit:ticket_roles:${userId}:${panelId}`)
      .setLabel("Reset Ticket Roles")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Secondary),
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`edit:add_question:${userId}:${panelId}`)
      .setLabel("Add Question")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(questions.length >= 20),
    new ButtonBuilder()
      .setCustomId(`edit:remove_question:${userId}:${panelId}`)
      .setLabel("Remove Last Question")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(questions.length === 0),
    new ButtonBuilder()
      .setCustomId(`edit:refresh_panel:${userId}:${panelId}`)
      .setLabel("Refresh Panel Message")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Success),
  );

  const payload = { embeds: [embed], components: [row1, row2, row3] };

  if ('replied' in interaction && (interaction.replied || interaction.deferred)) {
    await (interaction as ChatInputCommandInteraction).editReply(payload);
  } else {
    await (interaction as ChatInputCommandInteraction).reply({ ...payload, ephemeral: true });
  }
}

export async function handlePanelEditCommand(interaction: ChatInputCommandInteraction) {
  const panelIdStr = interaction.options.getString("panel", true);
  const panelId = parseInt(panelIdStr, 10);

  if (isNaN(panelId)) {
    await interaction.reply({ content: "Invalid panel selected.", ephemeral: true });
    return;
  }

  const guildId = interaction.guildId!;
  const panel = await db.query.ticketPanels.findFirst({
    where: and(eq(ticketPanels.id, panelId), eq(ticketPanels.guildId, guildId)),
  });

  if (!panel) {
    await interaction.reply({ content: "Panel not found in this server.", ephemeral: true });
    return;
  }

  setEditSession(interaction.user.id, guildId, { panelId, lastActivity: Date.now() });
  await sendEditMenu(interaction, panelId, interaction.user.id);
}

export async function handleEditBasicButton(interaction: ButtonInteraction, userId: string, panelId: number) {
  const panel = await db.query.ticketPanels.findFirst({ where: eq(ticketPanels.id, panelId) });
  if (!panel) {
    await interaction.reply({ content: "Panel not found.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`edit:basic_modal:${userId}:${panelId}`)
    .setTitle("Edit Panel Info");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Panel Title")
        .setStyle(TextInputStyle.Short)
        .setValue(panel.title)
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Panel Description")
        .setStyle(TextInputStyle.Paragraph)
        .setValue(panel.description)
        .setRequired(true)
        .setMaxLength(1024)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("button_name")
        .setLabel("Button Name")
        .setStyle(TextInputStyle.Short)
        .setValue(panel.buttonName)
        .setRequired(true)
        .setMaxLength(80)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("button_emoji")
        .setLabel("Button Emoji (optional)")
        .setStyle(TextInputStyle.Short)
        .setValue(panel.buttonEmoji ?? "")
        .setRequired(false)
        .setMaxLength(20)
    ),
  );

  await interaction.showModal(modal);
}

export async function handleEditBasicModal(interaction: ModalSubmitInteraction, userId: string, panelId: number) {
  const guildId = interaction.guildId!;
  const title = interaction.fields.getTextInputValue("title");
  const description = interaction.fields.getTextInputValue("description");
  const buttonName = interaction.fields.getTextInputValue("button_name");
  const buttonEmoji = interaction.fields.getTextInputValue("button_emoji") || null;

  await db.update(ticketPanels)
    .set({ title, description, buttonName, buttonEmoji })
    .where(eq(ticketPanels.id, panelId));

  await interaction.reply({ content: "✅ Panel info updated.", ephemeral: true });
}

export async function handleEditCategoryButton(interaction: ButtonInteraction, userId: string, panelId: number) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(`edit:category_select:${userId}:${panelId}`)
    .setPlaceholder("Select new category")
    .setChannelTypes(ChannelType.GuildCategory);

  const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select);

  await interaction.reply({ content: "Select the new category for tickets:", components: [row], ephemeral: true });
}

export async function handleEditCategorySelect(interaction: ChannelSelectMenuInteraction, userId: string, panelId: number) {
  const channel = interaction.channels.first();
  if (!channel) {
    await interaction.reply({ content: "No channel selected.", ephemeral: true });
    return;
  }

  await db.update(ticketPanels)
    .set({ categoryId: channel.id })
    .where(eq(ticketPanels.id, panelId));

  await interaction.reply({ content: `✅ Category updated to **${'name' in channel ? channel.name : channel.id}**.`, ephemeral: true });
}

export async function handleEditSupportRolesButton(interaction: ButtonInteraction, userId: string, panelId: number) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId(`edit:support_role_select:${userId}:${panelId}`)
    .setPlaceholder("Select new support roles (replaces existing)")
    .setMinValues(1)
    .setMaxValues(10);

  const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    content: "Select the new support roles (this will replace existing ones):",
    components: [row],
    ephemeral: true,
  });
}

export async function handleEditSupportRoleSelect(interaction: RoleSelectMenuInteraction, userId: string, panelId: number) {
  const newRoles = interaction.roles.map((r) => r.id);

  await db.delete(panelSupportRoles).where(eq(panelSupportRoles.panelId, panelId));
  await db.insert(panelSupportRoles).values(newRoles.map((roleId) => ({ panelId, roleId })));

  await interaction.reply({ content: `✅ Support roles updated (${newRoles.length} roles).`, ephemeral: true });
}

export async function handleEditTicketRolesButton(interaction: ButtonInteraction, userId: string, panelId: number) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId(`edit:ticket_role_select:${userId}:${panelId}`)
    .setPlaceholder("Select new ticket roles (replaces existing)")
    .setMinValues(1)
    .setMaxValues(10);

  const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    content: "Select the new ticket roles (replaces existing):",
    components: [row],
    ephemeral: true,
  });
}

export async function handleEditTicketRoleSelect(interaction: RoleSelectMenuInteraction, userId: string, panelId: number) {
  const newRoles = interaction.roles.map((r) => r.id);

  await db.delete(panelTicketRoles).where(eq(panelTicketRoles.panelId, panelId));
  await db.insert(panelTicketRoles).values(newRoles.map((roleId) => ({ panelId, roleId })));

  await interaction.reply({ content: `✅ Ticket roles updated (${newRoles.length} roles).`, ephemeral: true });
}

export async function handleEditAddQuestionButton(interaction: ButtonInteraction, userId: string, panelId: number) {
  const guildId = interaction.guildId!;
  setEditSession(userId, guildId, { panelId, lastActivity: Date.now() });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`edit:question_type:${userId}:${panelId}`)
    .setPlaceholder("Choose question type")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Text Question").setValue("text").setEmoji("✏️"),
      new StringSelectMenuOptionBuilder().setLabel("Choice Question").setValue("choice").setEmoji("📋"),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.reply({ content: "Select question type:", components: [row], ephemeral: true });
}

export async function handleEditQuestionTypeSelect(interaction: StringSelectMenuInteraction, userId: string, panelId: number) {
  const guildId = interaction.guildId!;
  const qType = interaction.values[0] as "text" | "choice";

  const session = getEditSession(userId, guildId) ?? { panelId, lastActivity: Date.now() };
  session.addingQuestionType = qType;
  setEditSession(userId, guildId, session);

  const modal = new ModalBuilder()
    .setCustomId(`edit:question_modal:${userId}:${panelId}`)
    .setTitle(qType === "text" ? "Add Text Question" : "Add Choice Question");

  const components = [
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("label")
        .setLabel("Question")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(256)
    ),
  ];

  if (qType === "choice") {
    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("choices")
          .setLabel("Choices (one per line, max 25)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
      )
    );
  }

  modal.addComponents(...components);
  await interaction.showModal(modal);
}

export async function handleEditQuestionModal(interaction: ModalSubmitInteraction, userId: string, panelId: number) {
  const guildId = interaction.guildId!;
  const session = getEditSession(userId, guildId);
  const qType = session?.addingQuestionType ?? "text";
  const label = interaction.fields.getTextInputValue("label");

  const existing = await db.select()
    .from(panelQuestions)
    .where(eq(panelQuestions.panelId, panelId));

  const [question] = await db.insert(panelQuestions).values({
    panelId,
    order: existing.length,
    type: qType,
    label,
  }).returning();

  if (question && qType === "choice") {
    const rawChoices = interaction.fields.getTextInputValue("choices");
    const choices = rawChoices
      .split("\n")
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .slice(0, 25);

    if (choices.length >= 2) {
      await db.insert(panelQuestionChoices).values(
        choices.map((c, idx) => ({
          questionId: question.id,
          label: c,
          value: c.toLowerCase().replace(/\s+/g, "_").slice(0, 100),
          order: idx,
        }))
      );
    }
  }

  await interaction.reply({ content: "✅ Question added.", ephemeral: true });
}

export async function handleEditRemoveQuestionButton(interaction: ButtonInteraction, userId: string, panelId: number) {
  const questions = await db.select()
    .from(panelQuestions)
    .where(eq(panelQuestions.panelId, panelId));

  if (questions.length === 0) {
    await interaction.reply({ content: "No questions to remove.", ephemeral: true });
    return;
  }

  const last = questions[questions.length - 1]!;
  await db.delete(panelQuestions).where(eq(panelQuestions.id, last.id));

  await interaction.reply({ content: `✅ Removed question: "${last.label}".`, ephemeral: true });
}

export async function handleEditRefreshPanel(interaction: ButtonInteraction, userId: string, panelId: number) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const panel = await db.query.ticketPanels.findFirst({
      where: eq(ticketPanels.id, panelId),
    });

    if (!panel || !panel.messageId) {
      await interaction.followUp({ content: "Panel or message not found.", ephemeral: true });
      return;
    }

    const guild = interaction.guild!;
    const channel = guild.channels.cache.get(panel.channelId);
    if (!channel || !channel.isTextBased()) {
      await interaction.followUp({ content: "Panel channel not found.", ephemeral: true });
      return;
    }

    const msg = await (channel as any).messages.fetch(panel.messageId).catch(() => null);
    if (!msg) {
      await interaction.followUp({ content: "Panel message not found.", ephemeral: true });
      return;
    }

    const { ticketPanelEmbed } = await import("../embeds");
    const embed = ticketPanelEmbed(panel.title, panel.description);
    const btn = buildTicketButton(panel.id, panel.buttonName, panel.buttonEmoji);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(btn);

    await msg.edit({ embeds: [embed], components: [row] });

    await interaction.followUp({ content: "✅ Panel message refreshed.", ephemeral: true });
  } catch (err) {
    logger.error({ err }, "Error refreshing panel");
    await interaction.followUp({ content: "❌ Failed to refresh panel.", ephemeral: true });
  }
}
