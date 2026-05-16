import {
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
} from "discord.js";
import { db } from "@workspace/db";
import {
  ticketPanels,
  panelSupportRoles,
  panelTicketRoles,
  panelQuestions,
  panelQuestionChoices,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  getSetupState,
  setSetupState,
  clearSetupState,
} from "../state";
import { setupStatusEmbed, ticketPanelEmbed } from "../embeds";
import { buildTicketButton } from "./ticket";
import { logger } from "../../lib/logger";

// ─── Shared UI builders ───────────────────────────────────────────────────────

function setupButtons(userId: string, questionCount: number) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:category:${userId}`)
      .setLabel("Set Category")
      .setEmoji("📁")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setup:support_role:${userId}`)
      .setLabel("Add Support Role")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setup:ticket_role:${userId}`)
      .setLabel("Add Ticket Role")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:add_text_q:${userId}`)
      .setLabel("Add Text Question")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(questionCount >= 20),
    new ButtonBuilder()
      .setCustomId(`setup:add_choice_q:${userId}`)
      .setLabel("Add Choice Question")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(questionCount >= 20),
    new ButtonBuilder()
      .setCustomId(`setup:remove_question:${userId}`)
      .setLabel("Remove Last Q")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(questionCount === 0),
    new ButtonBuilder()
      .setCustomId(`setup:create:${userId}`)
      .setLabel("Create Panel")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
  );

  return [row1, row2];
}

function backButton(userId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:back:${userId}`)
      .setLabel("← Back to Panel Setup")
      .setStyle(ButtonStyle.Secondary),
  );
}

// ─── /setup command ───────────────────────────────────────────────────────────

export async function handleSetupCommand(interaction: ChatInputCommandInteraction) {
  const modal = new ModalBuilder()
    .setCustomId(`setup:modal:${interaction.user.id}`)
    .setTitle("Create Ticket Panel");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Panel Title")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Support Tickets")
        .setRequired(true)
        .setMaxLength(100),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Panel Description")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Click the button below to open a support ticket.")
        .setRequired(true)
        .setMaxLength(1024),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("button_name")
        .setLabel("Ticket Button Name")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Open Ticket")
        .setRequired(true)
        .setMaxLength(80),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("button_emoji")
        .setLabel("Button Emoji (optional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("🎫")
        .setRequired(false)
        .setMaxLength(20),
    ),
  );

  await interaction.showModal(modal);
}

// ─── Modal submitted → show the live setup panel ─────────────────────────────

export async function handleSetupModal(interaction: ModalSubmitInteraction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId!;

  const title = interaction.fields.getTextInputValue("title");
  const description = interaction.fields.getTextInputValue("description");
  const buttonName = interaction.fields.getTextInputValue("button_name");
  const buttonEmoji = interaction.fields.getTextInputValue("button_emoji") || undefined;

  setSetupState(userId, guildId, {
    guildId,
    channelId,
    title,
    description,
    buttonName,
    buttonEmoji,
    categoryId: undefined,
    supportRoleIds: [],
    ticketRoleIds: [],
    questions: [],
    lastActivity: Date.now(),
  });

  const state = getSetupState(userId, guildId)!;

  await interaction.reply({
    embeds: [setupStatusEmbed(state)],
    components: setupButtons(userId, 0),
    ephemeral: true,
  });
}

// ─── Back button → restore the status panel ──────────────────────────────────

export async function handleSetupBack(interaction: ButtonInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);
  if (!state) {
    await interaction.update({ content: "Setup session expired. Run `/setup` again.", embeds: [], components: [] });
    return;
  }
  await interaction.update({
    content: "",
    embeds: [setupStatusEmbed(state)],
    components: setupButtons(userId, state.questions.length),
  });
}

// ─── Category ─────────────────────────────────────────────────────────────────

export async function handleSetupCategoryButton(interaction: ButtonInteraction, userId: string) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(`setup:category_select:${userId}`)
    .setPlaceholder("Select the category for tickets")
    .setChannelTypes(ChannelType.GuildCategory);

  await interaction.update({
    content: "**📁 Select the category where ticket channels will be created:**",
    embeds: [],
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select),
      backButton(userId),
    ],
  });
}

export async function handleSetupCategorySelect(interaction: ChannelSelectMenuInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);
  if (!state) {
    await interaction.update({ content: "Setup session expired. Run `/setup` again.", embeds: [], components: [] });
    return;
  }

  const channel = interaction.channels.first();
  if (!channel) {
    await interaction.update({ content: "No channel selected.", embeds: [], components: [] });
    return;
  }

  state.categoryId = channel.id;
  setSetupState(userId, guildId, state);

  await interaction.update({
    content: "",
    embeds: [setupStatusEmbed(state)],
    components: setupButtons(userId, state.questions.length),
  });
}

// ─── Support roles ────────────────────────────────────────────────────────────

export async function handleSetupSupportRoleButton(interaction: ButtonInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);

  const existing = state?.supportRoleIds.map((r) => `<@&${r}>`).join(", ") || "*(none yet)*";

  const select = new RoleSelectMenuBuilder()
    .setCustomId(`setup:support_role_select:${userId}`)
    .setPlaceholder("Select support roles to add")
    .setMinValues(1)
    .setMaxValues(10);

  await interaction.update({
    content: `**🛡️ Add Support Roles** — roles that can claim and close tickets.\nCurrently added: ${existing}`,
    embeds: [],
    components: [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select),
      backButton(userId),
    ],
  });
}

export async function handleSetupSupportRoleSelect(interaction: RoleSelectMenuInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);
  if (!state) {
    await interaction.update({ content: "Setup session expired. Run `/setup` again.", embeds: [], components: [] });
    return;
  }

  for (const [, role] of interaction.roles) {
    if (!state.supportRoleIds.includes(role.id)) {
      state.supportRoleIds.push(role.id);
    }
  }
  setSetupState(userId, guildId, state);

  await interaction.update({
    content: "",
    embeds: [setupStatusEmbed(state)],
    components: setupButtons(userId, state.questions.length),
  });
}

// ─── Ticket roles ─────────────────────────────────────────────────────────────

export async function handleSetupTicketRoleButton(interaction: ButtonInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);

  const existing = state?.ticketRoleIds.map((r) => `<@&${r}>`).join(", ") || "*(none — everyone can create)*";

  const select = new RoleSelectMenuBuilder()
    .setCustomId(`setup:ticket_role_select:${userId}`)
    .setPlaceholder("Select roles allowed to open tickets")
    .setMinValues(1)
    .setMaxValues(10);

  await interaction.update({
    content: `**🎫 Add Ticket Roles** — roles allowed to open tickets (leave empty = anyone).\nCurrently added: ${existing}`,
    embeds: [],
    components: [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select),
      backButton(userId),
    ],
  });
}

export async function handleSetupTicketRoleSelect(interaction: RoleSelectMenuInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);
  if (!state) {
    await interaction.update({ content: "Setup session expired. Run `/setup` again.", embeds: [], components: [] });
    return;
  }

  for (const [, role] of interaction.roles) {
    if (!state.ticketRoleIds.includes(role.id)) {
      state.ticketRoleIds.push(role.id);
    }
  }
  setSetupState(userId, guildId, state);

  await interaction.update({
    content: "",
    embeds: [setupStatusEmbed(state)],
    components: setupButtons(userId, state.questions.length),
  });
}

// ─── Questions ────────────────────────────────────────────────────────────────

export async function handleSetupAddTextQuestion(interaction: ButtonInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);
  if (!state) {
    await interaction.reply({ content: "Setup session expired. Run `/setup` again.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`setup:question_modal:${userId}:text`)
    .setTitle(`Add Text Question (${state.questions.length + 1}/20)`);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("label")
        .setLabel("Question text")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("What is your issue?")
        .setRequired(true)
        .setMaxLength(256),
    ),
  );

  await interaction.showModal(modal);
}

export async function handleSetupAddChoiceQuestion(interaction: ButtonInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);
  if (!state) {
    await interaction.reply({ content: "Setup session expired. Run `/setup` again.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`setup:question_modal:${userId}:choice`)
    .setTitle(`Add Choice Question (${state.questions.length + 1}/20)`);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("label")
        .setLabel("Question text")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("What category best describes your issue?")
        .setRequired(true)
        .setMaxLength(256),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("choices")
        .setLabel("Choices — one per line, max 25")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Billing Issue\nTechnical Problem\nAccount Help\nOther")
        .setRequired(true)
        .setMaxLength(2000),
    ),
  );

  await interaction.showModal(modal);
}

export async function handleSetupQuestionModal(
  interaction: ModalSubmitInteraction,
  userId: string,
  qType: "text" | "choice",
) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);
  if (!state) {
    await interaction.reply({ content: "Setup session expired. Run `/setup` again.", ephemeral: true });
    return;
  }

  const label = interaction.fields.getTextInputValue("label");

  if (qType === "choice") {
    const rawChoices = interaction.fields.getTextInputValue("choices");
    const choices = rawChoices
      .split("\n")
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .slice(0, 25);

    if (choices.length < 2) {
      await interaction.reply({ content: "❌ Please provide at least 2 choices.", ephemeral: true });
      return;
    }

    state.questions.push({ type: "choice", label, choices });
  } else {
    state.questions.push({ type: "text", label });
  }

  setSetupState(userId, guildId, state);

  // Reply with the full refreshed status panel so the user can continue
  await interaction.reply({
    embeds: [setupStatusEmbed(state)],
    components: setupButtons(userId, state.questions.length),
    ephemeral: true,
  });
}

export async function handleSetupRemoveQuestionButton(interaction: ButtonInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);
  if (!state) {
    await interaction.update({ content: "Setup session expired. Run `/setup` again.", embeds: [], components: [] });
    return;
  }

  if (state.questions.length === 0) {
    await interaction.update({
      embeds: [setupStatusEmbed(state)],
      components: setupButtons(userId, state.questions.length),
    });
    return;
  }

  state.questions.pop();
  setSetupState(userId, guildId, state);

  await interaction.update({
    content: "",
    embeds: [setupStatusEmbed(state)],
    components: setupButtons(userId, state.questions.length),
  });
}

// ─── Create panel ─────────────────────────────────────────────────────────────

export async function handleSetupCreate(interaction: ButtonInteraction, userId: string) {
  const guildId = interaction.guildId!;
  const state = getSetupState(userId, guildId);

  if (!state) {
    await interaction.update({ content: "Setup session expired. Run `/setup` again.", embeds: [], components: [] });
    return;
  }

  if (!state.categoryId) {
    await interaction.update({
      content: "",
      embeds: [setupStatusEmbed(state).setFooter({ text: "❌ You must set a category before creating the panel." })],
      components: setupButtons(userId, state.questions.length),
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    const guild = interaction.guild!;
    const channel = guild.channels.cache.get(state.channelId) ??
      await guild.channels.fetch(state.channelId);

    if (!channel || !channel.isTextBased()) {
      await interaction.followUp({ content: "❌ Could not find the channel.", ephemeral: true });
      return;
    }

    const [panel] = await db.insert(ticketPanels).values({
      guildId,
      channelId: state.channelId,
      title: state.title!,
      description: state.description!,
      buttonName: state.buttonName!,
      buttonEmoji: state.buttonEmoji ?? null,
      categoryId: state.categoryId,
    }).returning();

    if (!panel) {
      await interaction.followUp({ content: "❌ Database error creating panel.", ephemeral: true });
      return;
    }

    if (state.supportRoleIds.length > 0) {
      await db.insert(panelSupportRoles).values(
        state.supportRoleIds.map((roleId) => ({ panelId: panel.id, roleId }))
      );
    }

    if (state.ticketRoleIds.length > 0) {
      await db.insert(panelTicketRoles).values(
        state.ticketRoleIds.map((roleId) => ({ panelId: panel.id, roleId }))
      );
    }

    for (let i = 0; i < state.questions.length; i++) {
      const q = state.questions[i]!;
      const [question] = await db.insert(panelQuestions).values({
        panelId: panel.id,
        order: i,
        type: q.type,
        label: q.label,
      }).returning();

      if (question && q.type === "choice" && q.choices) {
        await db.insert(panelQuestionChoices).values(
          q.choices.map((c, idx) => ({
            questionId: question.id,
            label: c,
            value: c.toLowerCase().replace(/\s+/g, "_").slice(0, 100),
            order: idx,
          }))
        );
      }
    }

    const panelEmbed = ticketPanelEmbed(state.title!, state.description!);
    const ticketBtn = buildTicketButton(panel.id, state.buttonName!, state.buttonEmoji);
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(ticketBtn);

    // @ts-ignore — channel is text-based
    const msg = await channel.send({ embeds: [panelEmbed], components: [btnRow] });

    await db.update(ticketPanels)
      .set({ messageId: msg.id })
      .where(eq(ticketPanels.id, panel.id));

    clearSetupState(userId, guildId);

    const successEmbed = setupStatusEmbed(state);
    successEmbed.setTitle("✅ Panel Created!");
    successEmbed.setColor(0x57f287);
    successEmbed.setFooter({ text: `Panel ID: ${panel.id}` });

    await interaction.editReply({ embeds: [successEmbed], components: [] });
  } catch (err) {
    logger.error({ err }, "Error creating ticket panel");
    await interaction.followUp({ content: "❌ An error occurred while creating the panel.", ephemeral: true });
  }
}
