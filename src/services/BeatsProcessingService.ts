import { StatusBarService } from './StatusBarService';

export class BeatsProcessingService {
    constructor(private statusBarService: StatusBarService) {}

    showStatus(current: number, total: number): void {
        this.statusBarService.showBeatsStatus(current, total);
    }

    hideStatus(): void {
        this.statusBarService.hideBeatsStatus();
    }
}
