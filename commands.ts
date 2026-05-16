import {
  SlashCommandBuilder,
  REST,
  Routes,
} from "discord.js";
import { logger } from "../lib/logger";

export const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Create a new ticket panel in this channel")
    .setDefaultMemberPermissions("0")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("panel-edit")
    .setDescription("Edit an existing ticket panel")
    .setDefaultMemberPermissions("0")
    .addStringOption((opt) =>
      opt
        .setName("panel")
        .setDescription("The panel to edit")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Get the bot invite link")
    .toJSON(),
];

export async function registerCommands(clientId: string, token: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    logger.info("Registering slash commands globally...");
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    logger.info("Slash commands registered successfully.");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
}
