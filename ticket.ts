import {
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  type GuildTextBasedChannel,
} from "discord.js";
import { db } from "@workspace/db";
import {
  ticketPanels,
  panelSupportRoles,
  panelTicketRoles,
  panelQuestions,
  panelQuestionChoices,
  tickets,
  ticketAnswers,
} from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getTicketSession, setTicketSession, clearTicketSession } from "../state";
import { ticketInfoEmbed, closeDmEmbed } from "../embeds";
import { logger } from "../../lib/logger";

export function buildTicketButton(panelId: number, label: string, emoji?: string | null) {
  const btn = new ButtonBuilder()
    .setCustomId(`ticket:create:${panelId}`)
    .setLabel(label)
    .setStyle(ButtonStyle.Primary);
  if (emoji) btn.setEmoji(emoji);
  return btn;
}

function claimCloseRow(ticketId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:claim:${ticketId}`)
      .setLabel("Claim")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticketId}`)
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
  );
}

async function isSupportMember(userId: string, panelId: number, interaction: ButtonInteraction | ModalSubmitInteraction): Promise<boolean> {
  const supportRoles = await db.select()
    .from(panelSupportRoles)
    .where(eq(panelSupportRoles.panelId, panelId));

  if (supportRoles.length === 0) return true;

  const member = interaction.guild?.members.cache.get(userId) ??
    await interaction.guild?.members.fetch(userId).catch(() => null);

  if (!member) return false;
  return supportRoles.some((r) => member.roles.cache.has(r.roleId));
}

async function canCreateTicket(userId: string, panelId: number, interaction: ButtonInteraction): Promise<boolean> {
  const ticketRoles = await db.select()
    .from(panelTicketRoles)
    .where(eq(panelTicketRoles.panelId, panelId));

  if (ticketRoles.length === 0) return true;

  const member = interaction.guild?.members.cache.get(userId) ??
    await interaction.guild?.members.fetch(userId).catch(() => null);

  if (!member) return false;
  return ticketRoles.some((r) => member.roles.cache.has(r.roleId));
}

async function sendQuestionStep(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, userId: string) {
  const session = getTicketSession(userId);
  if (!session) {
    await (interaction as ButtonInteraction).reply?.({ content: "Session expired. Please click the ticket button again.", ephemeral: true });
    return;
  }

  const currentQ = session.questions[session.currentIndex];
  if (!currentQ) {
    await finalizeTicket(interaction, userId, session);
    return;
  }

  if (currentQ.type === "choice" && currentQ.choices && currentQ.choices.length > 0) {
    const options = currentQ.choices.slice(0, 25).map((c) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(c.label.slice(0, 100))
        .setValue(c.value.slice(0, 100))
    );

    const select = new StringSelectMenuBuilder()
      .setCustomId(`ticket:answer_choice:${userId}`)
      .setPlaceholder("Select an option...")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const embed = new EmbedBuilder()
      .setTitle(`Question ${session.currentIndex + 1}/${session.questions.length}`)
      .setDescription(`**${currentQ.label}**`)
      .setColor(0x5865f2)
      .setFooter({ text: "Select your answer below" });

    const reply = {
      embeds: [embed],
      components: [row],
      ephemeral: true,
    };

    if ('update' in interaction && session.sessionMessageId) {
      await (interaction as StringSelectMenuInteraction).update(reply as any);
    } else {
      if ('replied' in interaction && (interaction.replied || interaction.deferred)) {
        const msg = await (interaction as ButtonInteraction).followUp(reply as any);
        if (!session.sessionMessageId) {
          session.sessionMessageId = msg.id;
          setTicketSession(userId, session);
        }
      } else {
        await (interaction as ButtonInteraction).reply(reply as any);
      }
    }
  } else {
    const answerBtn = new ButtonBuilder()
      .setCustomId(`ticket:open_text_modal:${userId}`)
      .setLabel("Answer")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(answerBtn);

    const embed = new EmbedBuilder()
      .setTitle(`Question ${session.currentIndex + 1}/${session.questions.length}`)
      .setDescription(`**${currentQ.label}**`)
      .setColor(0x5865f2)
      .setFooter({ text: "Click Answer to type your response" });

    const reply = {
      embeds: [embed],
      components: [row],
      ephemeral: true,
    };

    if ('update' in interaction && session.sessionMessageId) {
      await (interaction as ButtonInteraction).update(reply as any);
    } else {
      if ('replied' in interaction && (interaction.replied || interaction.deferred)) {
        await (interaction as ButtonInteraction).followUp(reply as any);
      } else {
        await (interaction as ButtonInteraction).reply(reply as any);
      }
    }
  }
}

async function finalizeTicket(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  userId: string,
  session: ReturnType<typeof getTicketSession>
) {
  if (!session) return;

  try {
    const panel = await db.query.ticketPanels.findFirst({
      where: eq(ticketPanels.id, session.panelId),
    });

    if (!panel) {
      clearTicketSession(userId);
      return;
    }

    const guild = interaction.guild!;
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId);

    const count = await db.select().from(tickets).where(eq(tickets.panelId, panel.id));
    const ticketNumber = String(count.length + 1).padStart(4, "0");
    const channelName = `ticket-${ticketNumber}`;

    const supportRoles = await db.select()
      .from(panelSupportRoles)
      .where(eq(panelSupportRoles.panelId, panel.id));

    const category = guild.channels.cache.get(panel.categoryId);

    // All support roles + creator can see and chat on creation.
    // When claimed, non-claimant support role members are removed.
    const permissionOverwrites: any[] = [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: userId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: guild.members.me!.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];

    for (const sr of supportRoles) {
      permissionOverwrites.push({
        id: sr.roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites,
    });

    const [ticket] = await db.insert(tickets).values({
      panelId: panel.id,
      guildId: guild.id,
      channelId: ticketChannel.id,
      creatorId: userId,
      status: "open",
    }).returning();

    if (!ticket) throw new Error("Failed to insert ticket");

    if (session.answers.length > 0) {
      await db.insert(ticketAnswers).values(
        session.answers.map((a) => ({
          ticketId: ticket.id,
          questionId: a.questionId,
          answer: a.answer,
        }))
      );
    }

    const questions = session.questions;
    const answerTexts = questions.map((q) => {
      const ans = session.answers.find((a) => a.questionId === q.id);
      return ans?.answer ?? "*(no answer)*";
    });

    const infoEmbed = ticketInfoEmbed(panel.title, questions, answerTexts);
    infoEmbed.addFields({ name: "Created by", value: `<@${userId}>`, inline: true });

    const controlRow = claimCloseRow(ticket.id);

    await ticketChannel.send({
      content: `<@${userId}> ${supportRoles.map((r) => `<@&${r.roleId}>`).join(" ")}`,
      embeds: [infoEmbed],
      components: [controlRow],
    });

    clearTicketSession(userId);

    const successEmbed = new EmbedBuilder()
      .setTitle("🎫 Ticket Created!")
      .setDescription(`Your ticket has been created: <#${ticketChannel.id}>`)
      .setColor(0x57f287);

    if ('update' in interaction && session.sessionMessageId) {
      await (interaction as StringSelectMenuInteraction).update({ embeds: [successEmbed], components: [] });
    } else {
      if ('replied' in interaction && ((interaction as ButtonInteraction).replied || (interaction as ButtonInteraction).deferred)) {
        await (interaction as ButtonInteraction).followUp({ embeds: [successEmbed], ephemeral: true });
      } else {
        await (interaction as ButtonInteraction).reply({ embeds: [successEmbed], ephemeral: true });
      }
    }
  } catch (err) {
    logger.error({ err }, "Error finalizing ticket");
    clearTicketSession(userId);
  }
}

export async function handleTicketCreate(interaction: ButtonInteraction, panelId: number) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  const panel = await db.query.ticketPanels.findFirst({
    where: and(eq(ticketPanels.id, panelId), eq(ticketPanels.guildId, guildId)),
  });

  if (!panel) {
    await interaction.reply({ content: "This ticket panel no longer exists.", ephemeral: true });
    return;
  }

  const allowed = await canCreateTicket(userId, panelId, interaction);
  if (!allowed) {
    await interaction.reply({ content: "❌ You don't have permission to create a ticket.", ephemeral: true });
    return;
  }

  const existingTicket = await db.select()
    .from(tickets)
    .where(and(
      eq(tickets.panelId, panelId),
      eq(tickets.creatorId, userId),
      eq(tickets.guildId, guildId),
      eq(tickets.status, "open"),
    ))
    .limit(1);

  if (existingTicket.length > 0) {
    const ch = existingTicket[0]!;
    await interaction.reply({
      content: `❌ You already have an open ticket: <#${ch.channelId}>`,
      ephemeral: true,
    });
    return;
  }

  const questions = await db.select()
    .from(panelQuestions)
    .where(eq(panelQuestions.panelId, panelId))
    .orderBy(asc(panelQuestions.order));

  if (questions.length === 0) {
    const session = {
      panelId,
      guildId,
      channelId: interaction.channelId,
      currentIndex: 0,
      answers: [],
      questions: [],
      lastActivity: Date.now(),
    };
    setTicketSession(userId, session);
    await finalizeTicket(interaction, userId, session);
    return;
  }

  const questionChoices = await db.select()
    .from(panelQuestionChoices)
    .where(eq(panelQuestionChoices.questionId, questions[0]!.id));

  const enriched = await Promise.all(
    questions.map(async (q) => {
      const choices = await db.select()
        .from(panelQuestionChoices)
        .where(eq(panelQuestionChoices.questionId, q.id))
        .orderBy(asc(panelQuestionChoices.order));
      return { ...q, choices };
    })
  );

  setTicketSession(userId, {
    panelId,
    guildId,
    channelId: interaction.channelId,
    currentIndex: 0,
    answers: [],
    questions: enriched,
    lastActivity: Date.now(),
  });

  await sendQuestionStep(interaction, userId);
}

export async function handleOpenTextModal(interaction: ButtonInteraction, userId: string) {
  const session = getTicketSession(userId);
  if (!session) {
    await interaction.reply({ content: "Session expired. Please click the ticket button again.", ephemeral: true });
    return;
  }

  const currentQ = session.questions[session.currentIndex];
  if (!currentQ) {
    await interaction.reply({ content: "No more questions.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket:text_answer:${userId}`)
    .setTitle(`Question ${session.currentIndex + 1}/${session.questions.length}`);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("answer")
        .setLabel(currentQ.label.slice(0, 45))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1024)
    )
  );

  await interaction.showModal(modal);
}

export async function handleTextAnswer(interaction: ModalSubmitInteraction, userId: string) {
  const session = getTicketSession(userId);
  if (!session) {
    await interaction.reply({ content: "Session expired. Please click the ticket button again.", ephemeral: true });
    return;
  }

  const answer = interaction.fields.getTextInputValue("answer");
  const currentQ = session.questions[session.currentIndex]!;

  session.answers.push({ questionId: currentQ.id, answer });
  session.currentIndex++;
  setTicketSession(userId, session);

  if (session.currentIndex >= session.questions.length) {
    await interaction.deferUpdate().catch(() => interaction.deferReply({ ephemeral: true }));
    await finalizeTicket(interaction, userId, session);
  } else {
    await sendQuestionStep(interaction, userId);
  }
}

export async function handleChoiceAnswer(interaction: StringSelectMenuInteraction, userId: string) {
  const session = getTicketSession(userId);
  if (!session) {
    await interaction.reply({ content: "Session expired. Please click the ticket button again.", ephemeral: true });
    return;
  }

  const answer = interaction.values[0]!;
  const currentQ = session.questions[session.currentIndex]!;
  const choiceLabel = currentQ.choices?.find((c) => c.value === answer)?.label ?? answer;

  session.answers.push({ questionId: currentQ.id, answer: choiceLabel });
  session.currentIndex++;
  setTicketSession(userId, session);

  if (session.currentIndex >= session.questions.length) {
    await finalizeTicket(interaction, userId, session);
  } else {
    await sendQuestionStep(interaction, userId);
  }
}

export async function handleTicketClaim(interaction: ButtonInteraction, ticketId: number) {
  const userId = interaction.user.id;

  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
  });

  if (!ticket) {
    await interaction.reply({ content: "Ticket not found.", ephemeral: true });
    return;
  }

  const support = await isSupportMember(userId, ticket.panelId, interaction);
  if (!support) {
    await interaction.reply({ content: "❌ Only support staff can claim tickets.", ephemeral: true });
    return;
  }

  if (ticket.status === "closed") {
    await interaction.reply({ content: "❌ This ticket is already closed.", ephemeral: true });
    return;
  }

  await db.update(tickets)
    .set({ claimedBy: userId, status: "claimed" })
    .where(eq(tickets.id, ticketId));

  const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:claim:${ticketId}`)
      .setLabel(`Claimed by ${interaction.user.username}`)
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticketId}`)
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.update({ components: [newRow] });

  // Restrict the channel: deny all support roles, grant only the claimant
  const ticketChannel = interaction.guild?.channels.cache.get(ticket.channelId) as GuildTextBasedChannel | undefined;
  if (ticketChannel && "permissionOverwrites" in ticketChannel) {
    const supportRoles = await db.select()
      .from(panelSupportRoles)
      .where(eq(panelSupportRoles.panelId, ticket.panelId));

    // Remove ViewChannel from every support role so they can no longer see the ticket
    for (const sr of supportRoles) {
      await ticketChannel.permissionOverwrites.edit(sr.roleId, {
        ViewChannel: false,
        SendMessages: false,
      });
    }

    // Grant the claimant personal access
    await ticketChannel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });

    // Ensure creator's access is preserved
    await ticketChannel.permissionOverwrites.edit(ticket.creatorId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });

    await ticketChannel.send({
      content: `<@${userId}> has claimed this ticket!`,
    });
  }
}

export async function handleTicketClose(interaction: ButtonInteraction, ticketId: number) {
  const userId = interaction.user.id;

  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
  });

  if (!ticket) {
    await interaction.reply({ content: "Ticket not found.", ephemeral: true });
    return;
  }

  const support = await isSupportMember(userId, ticket.panelId, interaction);
  if (!support) {
    await interaction.reply({ content: "❌ Only support staff can close tickets.", ephemeral: true });
    return;
  }

  if (ticket.status === "closed") {
    await interaction.reply({ content: "❌ This ticket is already closed.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket:close_reason:${ticketId}`)
    .setTitle("Close Ticket");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason for closing")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Issue resolved, spam, etc.")
        .setRequired(true)
        .setMaxLength(512)
    )
  );

  await interaction.showModal(modal);
}

export async function handleTicketCloseReason(interaction: ModalSubmitInteraction, ticketId: number) {
  const userId = interaction.user.id;
  const reason = interaction.fields.getTextInputValue("reason");

  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
  });

  if (!ticket) {
    await interaction.reply({ content: "Ticket not found.", ephemeral: true });
    return;
  }

  const panel = await db.query.ticketPanels.findFirst({
    where: eq(ticketPanels.id, ticket.panelId),
  });

  await db.update(tickets)
    .set({ status: "closed", closeReason: reason, closedAt: new Date() })
    .where(eq(tickets.id, ticketId));

  const channel = interaction.guild?.channels.cache.get(ticket.channelId) as GuildTextBasedChannel | undefined;

  const closeEmbed = new EmbedBuilder()
    .setTitle("🔒 Ticket Closed")
    .setDescription(`This ticket has been closed by <@${userId}>.`)
    .addFields({ name: "Reason", value: reason })
    .setColor(0xed4245)
    .setTimestamp();

  const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:claim:${ticketId}`)
      .setLabel("Claim")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticketId}`)
      .setLabel("Closed")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
  );

  await interaction.reply({ embeds: [closeEmbed], components: [disabledRow] });

  if (channel) {
    setTimeout(async () => {
      try {
        await channel.delete();
      } catch {}
    }, 5000);
  }

  try {
    const creator = await interaction.client.users.fetch(ticket.creatorId).catch(() => null);
    if (creator) {
      const ticketName = channel?.name ?? `ticket-${ticketId}`;
      const dmEmbed = closeDmEmbed(
        ticketName,
        userId,
        reason,
        panel?.title ?? "Support"
      );
      await creator.send({ embeds: [dmEmbed] }).catch(() => {});
    }
  } catch (err) {
    logger.warn({ err }, "Could not DM ticket creator");
  }
}
