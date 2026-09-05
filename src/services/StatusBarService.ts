import type RadialTimelinePlugin from '../main';

export class StatusBarService {
    private beatsStatusBarItem: HTMLElement | null = null;

    constructor(private plugin: RadialTimelinePlugin) { }

    showBeatsStatus(current: number, total: number): void {
        if (!this.beatsStatusBarItem) {
            this.beatsStatusBarItem = this.plugin.addStatusBarItem();
            this.beatsStatusBarItem.addClass('rt-pulse-status-bar');
            this.plugin.registerDomEvent(this.beatsStatusBarItem, 'click', () => {
                if (this.plugin.activeBeatsModal) {
                    this.plugin.activeBeatsModal.open();
                }
            });
            this.beatsStatusBarItem.addClass('ert-cursor-pointer');
            this.beatsStatusBarItem.title = 'Click to view progress';
        }
        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        this.beatsStatusBarItem.setText(`Scene beats: ${current}/${total} (${percentage}%)`);
    }

    hideBeatsStatus(): void {
        if (this.beatsStatusBarItem) {
            this.beatsStatusBarItem.remove();
            this.beatsStatusBarItem = null;
        }
    }
}
