// Electron is provided by Obsidian on desktop; only the file-reveal API is used.
declare module "electron" {
  export const shell: {
    showItemInFolder(fullPath: string): void;
    openExternal(url: string): Promise<void>;
  };
}
