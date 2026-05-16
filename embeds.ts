import { EmbedBuilder, type ColorResolvable } from "discord.js";
import type { PendingSetup, QuestionConfig } from "./state";

export function setupStatusEmbed(state: PendingSetup): EmbedBuilder {
  const lines: string[] = [];

  lines.push(`**Title:** ${state.title ?? "*(not set)*"}`);
  lines.push(`**Description:** ${state.description ?? "*(not set)*"}`);
  lines.push(
    `**Button:** ${state.buttonEmoji ? `${state.buttonEmoji} ` : ""}${state.buttonName ?? "*(not set)*"}`
  );
  lines.push(
    `**Category:** ${state.categoryId ? `<#${state.categoryId}>` : "*(not set)*"}`
  );

  const supportRoles =
    state.supportRoleIds.length > 0
      ? state.supportRoleIds.map((r) => `<@&${r}>`).join(", ")
      : "*(none)*";
  lines.push(`**Support Roles:** ${supportRoles}`);

  const ticketRoles =
    state.ticketRoleIds.length > 0
      ? state.ticketRoleIds.map((r) => `<@&${r}>`).join(", ")
      : "*(anyone)*";
  lines.push(`**Ticket Roles:** ${ticketRoles}`);

  const questionList =
    state.questions.length > 0
      ? state.questions
          .map(
            (q, i) =>
              `${i + 1}. [${q.type.toUpperCase()}] ${q.label}${
                q.type === "choice" && q.choices
                  ? ` — ${q.choices.slice(0, 3).join(", ")}${q.choices.length > 3 ? "..." : ""}`
                  : ""
              }`
          )
          .join("\n")
      : "*(none)*";
  lines.push(`**Questions (${state.questions.length}/20):**\n${questionList}`);

  return new EmbedBuilder()
    .setTitle("🎫 Ticket Panel Setup")
    .setDescription(lines.join("\n"))
    .setColor(0x5865f2)
    .setFooter({ text: "Configure the panel then click Create Panel" });
}

export function ticketPanelEmbed(
  title: string,
  description: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x5865f2);
}

export function ticketInfoEmbed(
  panelTitle: string,
  questions: Array<{ label: string }>,
  answers: string[]
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${panelTitle}`)
    .setColor(0x5865f2)
    .setTimestamp();

  for (let i = 0; i < questions.length; i++) {
    embed.addFields({
      name: questions[i]!.label,
      value: answers[i] ?? "*(no answer)*",
      inline: false,
    });
  }

  return embed;
}

export function closeDmEmbed(
  ticketName: string,
  closedBy: string,
  reason: string,
  panelTitle: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🔒 Ticket Closed`)
    .setDescription(
      `Your ticket **${ticketName}** in **${panelTitle}** has been closed.`
    )
    .addFields(
      { name: "Closed by", value: `<@${closedBy}>`, inline: true },
      { name: "Reason", value: reason, inline: false }
    )
    .setColor(0xed4245)
    .setTimestamp();
}
