import * as vscode from "vscode";

const HERMES_EXTENSION_ID = "jefuriiij.hermes-studio";

export interface HermesHandoffMessages {
  opened: string;
  notInstalled: string;
}

export const defaultHermesMessages: HermesHandoffMessages = {
  opened: "Opened new chat in Hermes Studio. Context copied to clipboard.",
  notInstalled: "Hermes Studio extension is not installed or active. Context copied to clipboard.",
};

/**
 * Copies the prompt, then opens a new Hermes chat (falling back to the open-chat command).
 * Returns whether Hermes was available.
 */
export async function sendPromptToHermes(
  prompt: string,
  messages: HermesHandoffMessages = defaultHermesMessages,
): Promise<boolean> {
  await vscode.env.clipboard.writeText(prompt);

  const hermesExt = vscode.extensions.getExtension(HERMES_EXTENSION_ID);
  if (!hermesExt) {
    vscode.window.showWarningMessage(messages.notInstalled);
    return false;
  }

  if (!hermesExt.isActive) {
    await hermesExt.activate();
  }

  try {
    await vscode.commands.executeCommand("hermesStudio.newChat");
  } catch {
    await vscode.commands.executeCommand("hermesStudio.openChat");
  }

  vscode.window.showInformationMessage(messages.opened);
  return true;
}
