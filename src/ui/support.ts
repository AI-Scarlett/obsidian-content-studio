import { Modal } from "obsidian";

declare const MOGAO_DONATION_QR: string;

export class SupportModal extends Modal {
  onOpen(): void {
    this.titleEl.setText("支持墨稿开发");
    this.contentEl.addClass("mg-support-modal");
    this.contentEl.createEl("p", {
      text: "如果墨稿帮你省下了排版和发布的时间，欢迎用微信扫码，请我喝杯咖啡。感谢你支持插件持续维护和改进！",
    });
    this.contentEl.createEl("img", {
      attr: { src: MOGAO_DONATION_QR, alt: "微信打赏二维码，支持墨稿持续开发" },
    });
    this.contentEl.createEl("p", {
      cls: "mg-support-note",
      text: "打赏完全自愿。反馈问题、提出建议和收藏项目，同样是很好的支持。",
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
