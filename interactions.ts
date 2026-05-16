import {
  type Interaction,
  MessageFlags,
} from "discord.js";
import { logger } from "../../lib/logger";

import {
  handleSetupCommand,
  handleSetupModal,
  handleSetupBack,
  handleSetupCategoryButton,
  handleSetupCategorySelect,
  handleSetupSupportRoleButton,
  handleSetupSupportRoleSelect,
  handleSetupTicketRoleButton,
  handleSetupTicketRoleSelect,
  handleSetupAddTextQuestion,
  handleSetupAddChoiceQuestion,
  handleSetupQuestionModal,
  handleSetupRemoveQuestionButton,
  handleSetupCreate,
} from "./setup";

import {
  handleTicketCreate,
  handleOpenTextModal,
  handleTextAnswer,
  handleChoiceAnswer,
  handleTicketClaim,
  handleTicketClose,
  handleTicketCloseReason,
} from "./ticket";

import {
  handlePanelEditAutocomplete,
  handlePanelEditCommand,
  handleEditBasicButton,
  handleEditBasicModal,
  handleEditCategoryButton,
  handleEditCategorySelect,
  handleEditSupportRolesButton,
  handleEditSupportRoleSelect,
  handleEditTicketRolesButton,
  handleEditTicketRoleSelect,
  handleEditAddQuestionButton,
  handleEditQuestionTypeSelect,
  handleEditQuestionModal,
  handleEditRemoveQuestionButton,
  handleEditRefreshPanel,
} from "./panelEdit";

export async function handleInteraction(interaction: Interaction) {
  try {
    // ── Autocomplete ──────────────────────────────────────────────────────────
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "panel-edit") {
        await handlePanelEditAutocomplete(interaction);
      }
      return;
    }

    // ── Slash commands ────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup") {
        await handleSetupCommand(interaction);
      } else if (interaction.commandName === "panel-edit") {
        await handlePanelEditCommand(interaction);
      } else if (interaction.commandName === "invite") {
        await interaction.reply({
          content:
            "**Invite me to your server!**\nhttps://discord.com/oauth2/authorize?client_id=1504909063648051290&scope=bot%20applications.commands&permissions=8",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    // ── Buttons ───────────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const parts = interaction.customId.split(":");
      const ns = parts[0]!;
      const action = parts[1]!;

      if (ns === "setup") {
        const userId = parts[2]!;
        if (action === "back")           return handleSetupBack(interaction, userId);
        if (action === "category")       return handleSetupCategoryButton(interaction, userId);
        if (action === "support_role")   return handleSetupSupportRoleButton(interaction, userId);
        if (action === "ticket_role")    return handleSetupTicketRoleButton(interaction, userId);
        if (action === "add_text_q")     return handleSetupAddTextQuestion(interaction, userId);
        if (action === "add_choice_q")   return handleSetupAddChoiceQuestion(interaction, userId);
        if (action === "remove_question") return handleSetupRemoveQuestionButton(interaction, userId);
        if (action === "create")         return handleSetupCreate(interaction, userId);
      }

      if (ns === "ticket") {
        const id2 = parts[2]!;
        if (action === "create")         return handleTicketCreate(interaction, parseInt(id2, 10));
        if (action === "open_text_modal") return handleOpenTextModal(interaction, id2);
        if (action === "claim")          return handleTicketClaim(interaction, parseInt(id2, 10));
        if (action === "close")          return handleTicketClose(interaction, parseInt(id2, 10));
      }

      if (ns === "edit") {
        const userId = parts[2]!;
        const panelId = parseInt(parts[3]!, 10);
        if (action === "basic")           return handleEditBasicButton(interaction, userId, panelId);
        if (action === "category")        return handleEditCategoryButton(interaction, userId, panelId);
        if (action === "support_roles")   return handleEditSupportRolesButton(interaction, userId, panelId);
        if (action === "ticket_roles")    return handleEditTicketRolesButton(interaction, userId, panelId);
        if (action === "add_question")    return handleEditAddQuestionButton(interaction, userId, panelId);
        if (action === "remove_question") return handleEditRemoveQuestionButton(interaction, userId, panelId);
        if (action === "refresh_panel")   return handleEditRefreshPanel(interaction, userId, panelId);
      }

      return;
    }

    // ── Modals ────────────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(":");
      const ns = parts[0]!;
      const action = parts[1]!;

      if (ns === "setup") {
        const userId = parts[2]!;
        if (action === "modal")           return handleSetupModal(interaction);
        if (action === "question_modal") {
          const qType = (parts[3] ?? "text") as "text" | "choice";
          return handleSetupQuestionModal(interaction, userId, qType);
        }
      }

      if (ns === "ticket") {
        const id2 = parts[2]!;
        if (action === "text_answer")    return handleTextAnswer(interaction, id2);
        if (action === "close_reason")   return handleTicketCloseReason(interaction, parseInt(id2, 10));
      }

      if (ns === "edit") {
        const userId = parts[2]!;
        const panelId = parseInt(parts[3]!, 10);
        if (action === "basic_modal")    return handleEditBasicModal(interaction, userId, panelId);
        if (action === "question_modal") return handleEditQuestionModal(interaction, userId, panelId);
      }

      return;
    }

    // ── Channel select menus ──────────────────────────────────────────────────
    if (interaction.isChannelSelectMenu()) {
      const parts = interaction.customId.split(":");
      const ns = parts[0]!;
      const action = parts[1]!;

      if (ns === "setup"  && action === "category_select") return handleSetupCategorySelect(interaction, parts[2]!);
      if (ns === "edit"   && action === "category_select") return handleEditCategorySelect(interaction, parts[2]!, parseInt(parts[3]!, 10));
      return;
    }

    // ── Role select menus ─────────────────────────────────────────────────────
    if (interaction.isRoleSelectMenu()) {
      const parts = interaction.customId.split(":");
      const ns = parts[0]!;
      const action = parts[1]!;

      if (ns === "setup") {
        if (action === "support_role_select") return handleSetupSupportRoleSelect(interaction, parts[2]!);
        if (action === "ticket_role_select")  return handleSetupTicketRoleSelect(interaction, parts[2]!);
      }
      if (ns === "edit") {
        if (action === "support_role_select") return handleEditSupportRoleSelect(interaction, parts[2]!, parseInt(parts[3]!, 10));
        if (action === "ticket_role_select")  return handleEditTicketRoleSelect(interaction, parts[2]!, parseInt(parts[3]!, 10));
      }
      return;
    }

    // ── String select menus ───────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      const parts = interaction.customId.split(":");
      const ns = parts[0]!;
      const action = parts[1]!;

      if (ns === "ticket" && action === "answer_choice") return handleChoiceAnswer(interaction, parts[2]!);
      if (ns === "edit"   && action === "question_type") return handleEditQuestionTypeSelect(interaction, parts[2]!, parseInt(parts[3]!, 10));
      return;
    }

  } catch (err) {
    logger.error({ err, id: interaction.id }, "Error handling interaction");
    try {
      const i = interaction as any;
      if (i.replied || i.deferred) {
        await i.followUp({ content: "❌ An error occurred.", ephemeral: true });
      } else if (typeof i.reply === "function") {
        await i.reply({ content: "❌ An error occurred.", ephemeral: true });
      }
    } catch {}
  }
}
