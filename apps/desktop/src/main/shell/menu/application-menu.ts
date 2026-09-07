import { app, Menu, type MenuItemConstructorOptions } from "electron";

interface ApplicationMenuActions {
  quitApplication(): void;
}

export function installApplicationMenu(actions: ApplicationMenuActions): void {
  const quitItem: MenuItemConstructorOptions = {
    label: "退出 NediaMatrix",
    accelerator: "CommandOrControl+Q",
    click: actions.quitApplication,
  };
  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            role: "appMenu",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              quitItem,
            ],
          },
          { role: "fileMenu" },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ]
      : [
          {
            label: "文件",
            submenu: [{ role: "close" }, { type: "separator" }, quitItem],
          },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
