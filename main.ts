import { App, Plugin, Notice, Setting, PluginSettingTab, TFile, TAbstractFile } from "obsidian";

interface ManuscriptTimelineSettings {
    sourcePath: string;
    publishStageColors: {
        Zero: string;
        Author: string;
        House: string;
        Press: string;
    };
}

interface Scene {
    title: string;
    when: Date; //required
    subplot: string;
    synopsis?: string;
    actNumber: number;
    path: string;
    status: string;
    Character?: string[];
    due?: Date; //optional
    Edits?: string;
    "Publish Stage"?: string; // Changed from PublishStage to "Publish Stage"
}

// Add this interface to store scene number information for the scene square and synopsis
interface SceneNumberInfo {
    number: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

const DEFAULT_SETTINGS: ManuscriptTimelineSettings = {
    sourcePath: 'Book 1',
    publishStageColors: {
        "Zero": "#9E70CF",  // Purple
        "Author": "#5E85CF", // Blue
        "House": "#DA7847",  // Orange
        "Press": "#6FB971"   // Green
    }
};

//a primary color for each status
// 6FB971 green, DA7847 orange, 7C6561 flat brown, 9E70CF purple, 5E85CF Blue, bbbbbb gray 
const STATUS_COLORS = {
    "Working": "#70b970",
    "Todo": "#aaaaaa",
    "Empty": "#f0f0f0", // Light gray (will be replaced with light Zero color)
    "Due": "#d05e5e"
};

const NUM_ACTS = 3;

function formatNumber(num: number): string {
    if (Math.abs(num) < 0.001) return "0";
    return num.toFixed(3).replace(/\.?0+$/, '');
}

function parseSceneTitle(title: string): { number: string; text: string } {
    const firstSpace = title.indexOf(' ');
    if (firstSpace === -1) return { number: '', text: title };
    
    const number = title.substring(0, firstSpace);
    // Check if the first part is a valid number (integer or decimal)
    if (!number.match(/^\d+(\.\d+)?$/)) {
        return { number: '', text: title };
    }
    
    return {
        number: number,
        text: title.substring(firstSpace + 1)
    };
}

export default class ManuscriptTimelinePlugin extends Plugin {
    settings: ManuscriptTimelineSettings;

    async onload() {
        await this.loadSettings();
        
        // Add ribbon icon
        this.addRibbonIcon('calendar-range', 'Generate Manuscript Timeline', async () => {
            await this.generateTimeline();
        });

        // Add command
        this.addCommand({
            id: 'generate-manuscript-timeline',
            name: 'Generate Manuscript Timeline',
            callback: async () => {
                await this.generateTimeline();
            }
        });

        // Add settings tab
        this.addSettingTab(new ManuscriptTimelineSettingTab(this.app, this));

        // Add message listener for file opening
        window.addEventListener('message', async (event) => {
            if (event.data.type === 'open-file') {
                const file = this.app.vault.getAbstractFileByPath(event.data.path);
                if (file instanceof TFile) {
                    await this.app.workspace.getLeaf().openFile(file);
                }
            }
        });
    }

    // Method to generate timeline
    async generateTimeline(): Promise<void> {
        try {
            const sceneData = await this.getSceneData();
            if (sceneData.length === 0) {
                new Notice("No valid scene data found.");
                return;
            }
            await this.createTimelineHTML("Manuscript Timeline", sceneData);
            new Notice(`Manuscript timeline created with ${sceneData.length} scenes`);
        } catch (error) {
            console.error("Error generating timeline:", error);
            new Notice("Failed to create manuscript timeline");
        }
    }

    private async getSceneData(): Promise<Scene[]> {
        const files = this.app.vault.getMarkdownFiles()
            .filter(file => file.path.startsWith(this.settings.sourcePath));
        const scenes: Scene[] = [];
    
        for (const file of files) {
            const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (metadata?.Class === "Scene" && metadata?.When) {
                // Fix for date shift issue - ensure dates are interpreted as UTC
                const whenStr = metadata.When;
                
                // Directly parse the date in a way that preserves the specified date regardless of timezone
                // Use a specific time (noon UTC) to avoid any date boundary issues
                const when = new Date(`${whenStr}T12:00:00Z`);
                
                if (!isNaN(when.getTime())) {
                    // Split subplots if provided, otherwise default to "Main Plot"
                    const subplots = metadata.Subplot
                        ? Array.isArray(metadata.Subplot) 
                            ? metadata.Subplot 
                            : [metadata.Subplot]
                        : ["Main Plot"];
                    
                    // Read actNumber from metadata, default to 1 if missing
                    const actNumber = metadata.Act !== undefined ? Number(metadata.Act) : 1;
    
                    // Ensure actNumber is a valid number between 1 and 3
                    const validActNumber = (actNumber >= 1 && actNumber <= 3) ? actNumber : 1;
    
                    // Handle status as either string or array
                    let status = "Todo";
                    if (metadata.Status) {
                        if (Array.isArray(metadata.Status)) {
                            status = metadata.Status[0]; // Use first status if it's an array
                        } else {
                            status = metadata.Status;
                        }
                    }
    
                    // Parse Character metadata - it might be a string or array
                    let characters = metadata.Character;
                    if (characters) {
                        // Convert to array if it's a string
                        if (!Array.isArray(characters)) {
                            characters = [characters];
                        }
                        // Clean up the internal link format (remove [[ and ]])
                        characters = characters.map((char: string) => char.replace(/[\[\]]/g, ''));
                    }
    
                    // Create a separate entry for each subplot
                    subplots.forEach(subplot => {
                        scenes.push({
                            title: metadata.Title || file.basename,
                            when: when,
                            subplot: subplot,
                            synopsis: metadata.Synopsis ? String(metadata.Synopsis) : '',
                            actNumber: validActNumber,
                            path: file.path,
                            status: status,
                            Character: characters,
                            due: metadata.Due ? new Date(metadata.Due) : undefined,
                            Edits: metadata.Edits || '',
                            "Publish Stage": metadata["Publish Stage"] || 'Zero' // Changed from PublishStage to "Publish Stage"
                        });

                        // Add debug logging for Publish Stage
                        console.log(`Scene: ${metadata.Title || file.basename}, Status: ${status}, Publish Stage: ${metadata["Publish Stage"] || 'Zero'}`);
                    });
                }
            }
        }
        //sort scenes by when and then by scene number for the subplot radials
        return scenes.sort((a, b) => {
            // First compare by when
            const whenComparison = a.when.getTime() - b.when.getTime();
            if (whenComparison !== 0) return whenComparison;
            
            // If whens are equal, compare by scene number
            const aNumber = parseSceneTitle(a.title).number;
            const bNumber = parseSceneTitle(b.title).number;
            
            // Convert scene numbers to numbers for comparison
            const aNum = aNumber ? parseFloat(aNumber) : 0;
            const bNum = bNumber ? parseFloat(bNumber) : 0;
            
            return aNum - bNum;
        });
    }

    private createTimelineSVG(scenes: Scene[]): string {
        const size = 1600;
        const margin = 30;
        const innerRadius = 200; // the first ring is 200px from the center
        const outerRadius = size / 2 - margin;
    
        // Create a map to store scene number information for the scene square and synopsis
        const sceneNumbersMap = new Map<string, SceneNumberInfo>();
    
        // Collect all unique subplots
        const allSubplotsSet = new Set<string>();
        scenes.forEach(scene => {
            allSubplotsSet.add(scene.subplot);
        });
        const allSubplots = Array.from(allSubplotsSet);
    
        // Dynamically set NUM_RINGS based on the number of unique subplots
        const NUM_RINGS = allSubplots.length;
    
        const DEFAULT_RING_COLOR = '#333333'; // Dark gray
    
        // Group scenes by Act and Subplot
        const scenesByActAndSubplot: { [act: number]: { [subplot: string]: Scene[] } } = {};
    
        for (let act = 0; act < NUM_ACTS; act++) {
            scenesByActAndSubplot[act] = {};
        }
    
        scenes.forEach(scene => {
            const act = scene.actNumber - 1; // Subtract 1 for 0-based index
    
            // Ensure act is within valid range
            const validAct = (act >= 0 && act < NUM_ACTS) ? act : 0;
    
            const subplot = scene.subplot || 'Default';
    
            if (!scenesByActAndSubplot[validAct][subplot]) {
                scenesByActAndSubplot[validAct][subplot] = [];
            }
    
            scenesByActAndSubplot[validAct][subplot].push(scene);
        });
    
        // Define the months and their angles
        const months = Array.from({ length: 12 }, (_, i) => {
            const angle = (i / 12) * 2 * Math.PI - Math.PI / 2; // Adjust so January is at the top
            const name = new Date(2000, i).toLocaleString('en-US', { month: 'long' });
            const shortName = new Date(2000, i).toLocaleString('en-US', { month: 'short' }).slice(0, 3);
            return { name, shortName, angle };
        });
    
        // Calculate total available space
        const availableSpace = outerRadius - innerRadius;
    
        // Set the reduction factor for ring widths (if you want equal widths, set reductionFactor to 1)
        const reductionFactor = 1; // For equal ring widths
        const N = NUM_RINGS;
    
        // Calculate the sum of the geometric series (simplifies to N when reductionFactor is 1)
        const sumOfSeries = (reductionFactor === 1) ? N : (1 - Math.pow(reductionFactor, N)) / (1 - reductionFactor);
    
        // Calculate the initial ring width to fill the available space
        const initialRingWidth = availableSpace / sumOfSeries;
    
        // Calculate each ring's width
        const ringWidths = Array.from({ length: N }, (_, i) => initialRingWidth * Math.pow(reductionFactor, i));
    
        // Calculate the start radii for each ring
        const ringStartRadii = ringWidths.reduce((acc, width, i) => {
            const previousRadius = i === 0 ? innerRadius : acc[i - 1] + ringWidths[i - 1];
            acc.push(previousRadius);
            return acc;
        }, [] as number[]);
    
        // Months radius outer and inner
        const lineInnerRadius = ringStartRadii[0] - 20;
        const lineOuterRadius = ringStartRadii[N - 1] + ringWidths[N - 1] + 30;
    
        // **Include the `<style>` code here**
        let svg = `<svg width="${size}" height="${size}" viewBox="-${size / 2} -${size / 2} ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="background-color: transparent;">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;900&display=swap');

            svg {
                font-family: 'Lato', sans-serif;
                background-color: transparent;
            }

            .scene-title {
                fill: white;
                opacity: 1;
                pointer-events: none;
            }

            .scene-title.faded {
                fill: var(--text-muted, #666666);
                opacity: 0.2;
            }

            .center-number-text {
                fill: var(--text-normal, #333333);
                font-size: 140px;
                pointer-events: none;
                font-weight: 900;
            }

            .scene-act {
                fill-opacity: 0;
                transition: fill-opacity 0.2s;
            }

            .scene-act:hover {
                fill-opacity: 0.3;
                cursor: pointer;
            }

            .scene-info {
                opacity: 0;
                transition: opacity 0.2s;
                pointer-events: none;
            }

            .scene-group:hover .scene-info {
                opacity: 1;
            }

            .number-text {
                font-size: 14px;
                pointer-events: none;
            }

            .number-text.faded {
                opacity: 0.2;
            }

            .number-square {
                opacity: 1;
                pointer-events: none;
            }

            .number-square.faded {
                opacity: 0.2;
            }

            .scene-path {
                opacity: 1;
                transition: opacity 0.2s ease-out;
                pointer-events: all;
            }

            .scene-path.faded {
                opacity: 0.5;
                transition: opacity 0.2s ease-out;
            }

            .scene-path.highlighted {
                opacity: 1;
                transition: opacity 0.2s ease-out;
            }

            .info-title {
                fill: var(--text-normal, #333333);
                font-size: 28px;
                text-anchor: middle;
            }

            .subplot-text {
                fill: var(--text-normal, #333333);
                font-size: 28px;
                text-anchor: middle;
            }

            .synopsis-text {
                fill: var(--text-normal, #333333);
                font-size: 28px;
                text-anchor: middle;
            }

            .month-label {
                fill: var(--text-normal, #333333);
                font-size: 16px;
                pointer-events: none;
                dominant-baseline: middle;
            }

            .month-label-outer {
                fill: var(--text-normal, #333333);
                font-size: 20px;
                pointer-events: none;
                dominant-baseline: middle;
            }

            .act-label {
                fill: var(--text-normal, #333333);
                font-size: 20px;
                font-weight: bold;
                pointer-events: none;
                dominant-baseline: middle;
            }

            .info-container {
                fill: var(--text-normal, #333333);
                font-size: 24px;
            }

            .info-text {
                dominant-baseline: hanging;
                text-anchor: start;
                fill: var(--text-normal, #333333);
            }
            
            .key-text {
                fill: var(--text-normal, #333333);
                font-size: 16px;
                transition: fill 0.2s ease;
            }
            
            // Add CSS classes for month spokes in the SVG style section
            .month-spoke-line {
                stroke: var(--text-normal, #333333);
                stroke-width: 1;
            }

            .month-spoke-line.act-boundary {
                stroke: var(--text-accent, #705dcf);
                stroke-width: 3;
            }
            
            // Add CSS classes for act borders and progress ring
            .act-border {
                stroke: var(--text-accent, #705dcf);
                stroke-width: 5;
                fill: none;
            }

            .progress-ring-base {
                stroke: var(--background-modifier-border, #dddddd);
                stroke-width: 10;
                fill: none;
            }

            .progress-ring-fill {
                /* Stroke color is applied via gradient in the SVG */
                stroke-width: 10;
                fill: none;
            }
            
            /* Ensure key-text elements are styled correctly */
            .theme-dark .key-text {
                fill: #ffffff !important;
            }
            
            .theme-light .key-text {
                fill: #333333 !important;
            }
            
            /* Always keep info-text dark for better visibility against light background */
            .info-text {
                fill: #333333 !important;
            }

            .color-key-center {
                opacity: 1;
                pointer-events: none;
            }

            .center-key-text {
                fill: var(--text-normal, #333333);
                font-size: 18px;
                text-transform: uppercase;
                opacity: 0.85; /* Slightly transparent */
            }
        </style>`;

        // Access the publishStageColors from settings
        const PUBLISH_STAGE_COLORS = this.settings.publishStageColors;

        // Begin defs act
        svg += `<defs>`;
        
        // Define plaid patterns for Working and Todo status
        svg += `<pattern id="plaidWorking" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="${this.darkenColor(STATUS_COLORS.Working, 10)}"/>
            <line x1="0" y1="0" x2="0" y2="10" stroke="#ffffff" stroke-width="2.5" stroke-opacity="0.6"/>
            <line x1="0" y1="0" x2="10" y2="0" stroke="#ffffff" stroke-width="2.5" stroke-opacity="0.6"/>
        </pattern>`;
        
        svg += `<pattern id="plaidTodo" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="${this.lightenColor(STATUS_COLORS.Todo, 15)}"/>
            <line x1="0" y1="0" x2="0" y2="10" stroke="#ffffff" stroke-width="1" stroke-opacity="0.3"/>
            <line x1="0" y1="0" x2="10" y2="0" stroke="#ffffff" stroke-width="1" stroke-opacity="0.3"/>
        </pattern>`;
        
        // Define patterns for Working and Todo states with Publish Stage colors
        svg += `${Object.entries(PUBLISH_STAGE_COLORS).map(([stage, color]) => `
            <pattern id="plaidWorking${stage}" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="${this.darkenColor(color, 10)}"/>
                <line x1="0" y1="0" x2="0" y2="10" stroke="#ffffff" stroke-width="2.5" stroke-opacity="0.6"/>
                <line x1="0" y1="0" x2="10" y2="0" stroke="#ffffff" stroke-width="2.5" stroke-opacity="0.6"/>
            </pattern>
            
            <pattern id="plaidTodo${stage}" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="${this.lightenColor(color, 20)}"/>
                <line x1="0" y1="0" x2="0" y2="10" stroke="#ffffff" stroke-width="1" stroke-opacity="0.3"/>
                <line x1="0" y1="0" x2="10" y2="0" stroke="#ffffff" stroke-width="1" stroke-opacity="0.3"/>
            </pattern>
        `).join('')}`;
        
        // Define outer arc paths for months
        months.forEach(({ name, angle }, index) => {
            // Calculate angular offset for 9px at the label radius
            const outerlabelRadius = lineOuterRadius - 15; //the larger the number the closer to the center
            // Convert 5px to radians based on the circle's circumference
            const pixelToRadian = (5 * 2 * Math.PI) / (2 * Math.PI * outerlabelRadius);
            
            // Make the month offset very small, similar to but positive (clockwise) for Acts
            const angleOffset = 0.01; // Half of previous value (0.02)
            const startAngle = angle + angleOffset;  // Small offset to move label clockwise
            const endAngle = startAngle + (Math.PI / 24); // Short arc length
  
            const pathId = `monthLabelPath-${index}`;

            svg += `
                <path id="${pathId}"
                    d="
                        M ${formatNumber(outerlabelRadius * Math.cos(startAngle))} ${formatNumber(outerlabelRadius * Math.sin(startAngle))}
                        A ${formatNumber(outerlabelRadius)} ${formatNumber(outerlabelRadius)} 0 0 1 ${formatNumber(outerlabelRadius * Math.cos(endAngle))} ${formatNumber(outerlabelRadius * Math.sin(endAngle))}
                    "
                    fill="none"
                />
            `;
        });

        // Close defs act
        svg += `</defs>`;

        //outer months Labels
        months.forEach(({ name }, index) => {
            const pathId = `monthLabelPath-${index}`;
            svg += `
                <text class="month-label-outer">
                    <textPath href="#${pathId}" startOffset="0" text-anchor="start">
                        ${name}
                    </textPath>
                </text>
            `;
        });

        // First add the progress ring (move this BEFORE the month spokes code)
        // Calculate year progress
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const yearProgress = (now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24 * 365);

        // Create progress ring
        const progressRadius = lineInnerRadius + 15;
        const circumference = 2 * Math.PI * progressRadius;
        const progressLength = circumference * yearProgress;
        const startAngle = -Math.PI / 2; // Start at 12 o'clock
        const endAngle = startAngle + (2 * Math.PI * yearProgress);

        // Define rainbow gradients for the segments
        svg += `<defs>
            <linearGradient id="linearColors1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#FF0000"></stop>
                <stop offset="100%" stop-color="#FF7F00"></stop>
            </linearGradient>
            <linearGradient id="linearColors2" x1="0.5" y1="0" x2="0.5" y2="1">
                <stop offset="0%" stop-color="#FF7F00"></stop>
                <stop offset="100%" stop-color="#FFFF00"></stop>
            </linearGradient>
            <linearGradient id="linearColors3" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#FFFF00"></stop>
                <stop offset="100%" stop-color="#00FF00"></stop>
            </linearGradient>
            <linearGradient id="linearColors4" x1="1" y1="1" x2="0" y2="0">
                <stop offset="0%" stop-color="#00FF00"></stop>
                <stop offset="100%" stop-color="#0000FF"></stop>
            </linearGradient>
            <linearGradient id="linearColors5" x1="0.5" y1="1" x2="0.5" y2="0">
                <stop offset="0%" stop-color="#0000FF"></stop>
                <stop offset="100%" stop-color="#4B0082"></stop>
            </linearGradient>
            <linearGradient id="linearColors6" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stop-color="#4B0082"></stop>
                <stop offset="100%" stop-color="#8F00FF"></stop>
            </linearGradient>
        </defs>`;

        // Add the base gray circle
        svg += `
            <circle
                cx="0"
                cy="0"
                r="${progressRadius}"
                class="progress-ring-base"
            />
        `;

        // Create six segments for the rainbow
        const segmentCount = 6;
        const fullCircleAngle = 2 * Math.PI;
        const segmentAngle = fullCircleAngle / segmentCount;
        
        // Calculate how many complete segments to show based on year progress
        const completeSegments = Math.floor(yearProgress * segmentCount);
        
        // Calculate the partial segment angle (for the last visible segment)
        const partialSegmentAngle = (yearProgress * segmentCount - completeSegments) * segmentAngle;
        
        // Draw each segment that should be visible
        for (let i = 0; i < segmentCount; i++) {
            // Calculate this segment's start and end angles
            const segStart = startAngle + (i * segmentAngle);
            let segEnd = segStart + segmentAngle;
            
            // If this is beyond what should be shown based on year progress, skip it
            if (i > completeSegments) continue;
            
            // If this is the last partial segment, adjust the end angle
            if (i === completeSegments && partialSegmentAngle > 0) {
                segEnd = segStart + partialSegmentAngle;
            }
            
            // Create the arc path for this segment
            svg += `
                <path
                    d="
                        M ${progressRadius * Math.cos(segStart)} ${progressRadius * Math.sin(segStart)}
                        A ${progressRadius} ${progressRadius} 0 ${(segEnd - segStart) > Math.PI ? 1 : 0} 1 
                        ${progressRadius * Math.cos(segEnd)} ${progressRadius * Math.sin(segEnd)}
                    "
                    class="progress-ring-fill"
                    stroke="url(#linearColors${i+1})"
                />
            `;
        }

        // THEN add the month spokes group (existing code)
        svg += `<g class="month-spokes">`;
        
        // For each month, draw the inner spoke and labels
 
        // Then modify the inner month labels to curve along the inner arc
        months.forEach(({ name, angle }, monthIndex) => {
            const x1 = formatNumber((lineInnerRadius - 5) * Math.cos(angle));
            const y1 = formatNumber((lineInnerRadius - 5) * Math.sin(angle));
            const x2 = formatNumber(lineOuterRadius * Math.cos(angle));
            const y2 = formatNumber(lineOuterRadius * Math.sin(angle));

            // Check if this is an Act boundary (months 0, 4, or 8)
            const isActBoundary = [0, 4, 8].includes(monthIndex);

            // Draw the spoke line
            svg += `
                <line  
                    x1="${x1}"
                    y1="${y1}"
                    x2="${x2}"
                    y2="${y2}"
                    class="month-spoke-line${isActBoundary ? ' act-boundary' : ''}"
                />`;

            // Create curved path for inner month labels
            const innerLabelRadius = lineInnerRadius;
            const pixelToRadian = (5 * 2 * Math.PI) / (2 * Math.PI * innerLabelRadius);
            const startAngle = angle + pixelToRadian;
            const endAngle = angle + (Math.PI / 6);
            
            const innerPathId = `innerMonthPath-${name}`;
            
            svg += `
                <path id="${innerPathId}"
                    d="
                        M ${formatNumber(innerLabelRadius * Math.cos(startAngle))} ${formatNumber(innerLabelRadius * Math.sin(startAngle))}
                        A ${formatNumber(innerLabelRadius)} ${formatNumber(innerLabelRadius)} 0 0 1 ${formatNumber(innerLabelRadius * Math.cos(endAngle))} ${formatNumber(innerLabelRadius * Math.sin(endAngle))}
                    "
                    fill="none"
                />
                <text class="month-label">
                    <textPath href="#${innerPathId}" startOffset="0" text-anchor="start">
                        ${months[monthIndex].shortName}
                    </textPath>
                </text>
            `;
        });

         // Close the month spokes lines and text labels group
        svg += `</g>`;

        // Create master subplot order before the act loop
        const masterSubplotOrder = (() => {
            // Create a combined set of all subplots from all acts
            const allSubplotsMap = new Map<string, number>();
            
            // Iterate through all acts to gather all subplots
            for (let actIndex = 0; actIndex < NUM_ACTS; actIndex++) {
                Object.entries(scenesByActAndSubplot[actIndex] || {}).forEach(([subplot, scenes]) => {
                    // Add scenes count to existing count or initialize
                    allSubplotsMap.set(subplot, (allSubplotsMap.get(subplot) || 0) + scenes.length);
                });
            }
            
            // Convert map to array of subplot objects
            const subplotCounts = Array.from(allSubplotsMap.entries()).map(([subplot, count]) => ({
                subplot,
                count
            }));

            // Sort subplots, but ensure "Main Plot" or empty subplot is first
            subplotCounts.sort((a, b) => {
                // If either subplot is "Main Plot" or empty, prioritize it
                if (a.subplot === "Main Plot" || !a.subplot) return -1;
                if (b.subplot === "Main Plot" || !b.subplot) return 1;
                // Otherwise, sort by count as before
                return b.count - a.count;
            });

            return subplotCounts.map(item => item.subplot);
        })();

        // Synopses at end to be above all other elements
        const synopsesHTML: string[] = [];
        scenes.forEach((scene) => {
            const subplotIndex = masterSubplotOrder.indexOf(scene.subplot);
            const ring = NUM_RINGS - 1 - subplotIndex;
            
            // Get the scenes for this act and subplot to determine correct index
            const scenesInActAndSubplot = scenesByActAndSubplot[scene.actNumber - 1][scene.subplot] || [];
            const sceneIndex = scenesInActAndSubplot.indexOf(scene);
            
            const sceneId = `scene-path-${scene.actNumber - 1}-${ring}-${sceneIndex}`;
            const numberInfo = sceneNumbersMap.get(sceneId);
            
            const lineHeight = 30;
            const size = 1600;
            const maxTextWidth = 500;
            const topOffset = -size / 2;

            // Generate random colors for characters
            const characterColors = scene.Character?.map(char => 
                '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
            ) || [];

            // Find all subplots this scene belongs to
            const allSceneSubplots = scenes
                .filter(s => s.path === scene.path)
                .map(s => s.subplot);

            // Reorder subplots to put the current ring's subplot first
            const orderedSubplots = [
                scene.subplot,
                ...allSceneSubplots.filter(s => s !== scene.subplot)
            ];

            // Prepare text content with modified format
            const synopsisLines = scene.synopsis ? 
                this.splitIntoBalancedLines(scene.synopsis, maxTextWidth) : [];

            const contentLines = [
                `${scene.title} - ${scene.when.toLocaleDateString()}`,
                ...synopsisLines,
                // Add a non-breaking space to preserve the line spacing
                '\u00A0', // Using non-breaking space instead of empty string
                // Subplots with bullet-like separator
                orderedSubplots.map((subplot, i) => 
                    `<tspan style="font-size: 17px; fill: #555555; text-transform: uppercase; font-weight: bold;">${subplot}</tspan>`
                ).join(`<tspan style="font-size: 17px; fill: #555555;"> • </tspan>`),
                // Characters with bullets between them
                scene.Character && scene.Character.length > 0 ? 
                    scene.Character.map((char, i) => 
                        `<tspan style="fill: ${characterColors[i]}; font-size: 14px;">${char.toUpperCase()}</tspan>`
                    ).join(`<tspan style="fill: ${characterColors[0]}; font-size: 14px;"> • </tspan>`) : '',
            ].filter(line => line);

            const totalHeight = contentLines.length * lineHeight;

            // Determine which text block to show based on Act number
            const showLeftText = scene.actNumber <= 2;
            const showRightText = scene.actNumber === 3;

            synopsesHTML.push(`
                <g class="scene-info info-container" 
                   style="opacity: 0; pointer-events: none;" 
                   data-for-scene="${sceneId}">
                    ${showLeftText ? `
                    <!-- Left side text block -->
                    <g transform="translate(-650, -400)">
                        ${contentLines.map((line, i) => `
                            <text class="info-text" x="10" y="${i * lineHeight}"
                                style="${i === 0 ? 'font-size: 24px; font-weight: bold;' : ''}"
                            >${line}</text>
                        `).join('')}
                    </g>
                    ` : ''}

                    ${showRightText ? `
                    <!-- Right side text block -->
                    <g transform="translate(-300, 250)">
                        ${contentLines.map((line, i) => `
                            <text class="info-text" x="0" y="${i * lineHeight}"
                                style="${i === 0 ? 'font-size: 24px; font-weight: bold;' : ''}"
                                text-anchor="middle"
                            >${line}</text>
                        `).join('')}
                    </g>
                    ` : ''}
                </g>
            `);
        });

        // Draw scenes and dummy scenes (existing code remains as is)
        for (let act = 0; act < NUM_ACTS; act++) {
            const totalRings = NUM_RINGS;
            const subplotCount = masterSubplotOrder.length;
            const ringsToUse = Math.min(subplotCount, totalRings);

            for (let ringOffset = 0; ringOffset < ringsToUse; ringOffset++) {
                const ring = totalRings - ringOffset - 1; // Start from the outermost ring
                
                const innerR = ringStartRadii[ring];
                const outerR = innerR + ringWidths[ring];
                
                const startAngle = (act * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
                const endAngle = ((act + 1) * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
                
                // Use the subplot from the master order instead of the current act's order
                const subplot = masterSubplotOrder[ringOffset];
                
                if (subplot) {
                    const currentScenes = scenesByActAndSubplot[act][subplot] || [];

                    if (currentScenes && currentScenes.length > 0) {
                        const sceneAngleSize = (endAngle - startAngle) / currentScenes.length;
            
                        currentScenes.forEach((scene, idx) => {
                            const { number, text } = parseSceneTitle(scene.title);
                            const sceneStartAngle = startAngle + (idx * sceneAngleSize);
                            const sceneEndAngle = sceneStartAngle + sceneAngleSize;
                            const textPathRadius = (innerR + outerR) / 2;
            
                            // Determine the color of a scene based on its status and due date
                            const color = (() => {
                                const statusList = Array.isArray(scene.status) ? scene.status : [scene.status];
                                const normalizedStatus = statusList[0]?.toString().trim().toLowerCase() || '';
                                
                                // Get the publish stage for pattern selection
                                const publishStage = scene["Publish Stage"] || 'Zero';
                                
                                if (normalizedStatus === "complete") {
                                    // For completed scenes, use Publish Stage color with full opacity
                                    const stageColor = PUBLISH_STAGE_COLORS[publishStage as keyof typeof PUBLISH_STAGE_COLORS] || PUBLISH_STAGE_COLORS.Zero;
                                    // Do not apply any modifications to the color to ensure it matches the legend
                                    return stageColor;
                                }
                                if (scene.due && new Date() > new Date(scene.due)) {
                                    return STATUS_COLORS.Due; // Use Due color if past due date
                                }
                                
                                // Check for working or todo status to use plaid pattern
                                if (normalizedStatus === "working") {
                                    return `url(#plaidWorking${publishStage})`;
                                }
                                if (normalizedStatus === "todo") {
                                    return `url(#plaidTodo${publishStage})`;
                                }
                                
                                return STATUS_COLORS[statusList[0] as keyof typeof STATUS_COLORS] || STATUS_COLORS.Todo; // Use status color or default to Todo
                            })();
            
                        
                            // Construct the arc path for the scene
                            const arcPath = `
                                M ${formatNumber(innerR * Math.cos(sceneStartAngle))} ${formatNumber(innerR * Math.sin(sceneStartAngle))}
                                L ${formatNumber(outerR * Math.cos(sceneStartAngle))} ${formatNumber(outerR * Math.sin(sceneStartAngle))}
                                A ${formatNumber(outerR)} ${formatNumber(outerR)} 0 0 1 ${formatNumber(outerR * Math.cos(sceneEndAngle))} ${formatNumber(outerR * Math.sin(sceneEndAngle))}
                                L ${formatNumber(innerR * Math.cos(sceneEndAngle))} ${formatNumber(innerR * Math.sin(sceneEndAngle))}
                                A ${formatNumber(innerR)} ${formatNumber(innerR)} 0 0 0 ${formatNumber(innerR * Math.cos(sceneStartAngle))} ${formatNumber(innerR * Math.sin(sceneStartAngle))}
                            `;
            
                            const sceneId = `scene-path-${act}-${ring}-${idx}`;
            
                            // In createTimelineSVG method, replace the font size calculation with a fixed size:
                            const fontSize = 18; // Fixed font size for all rings
                            const dyOffset = -1; // Small negative offset to align with top curve with 1px padding
            
                            svg += `
                            <g class="scene-group" data-path="${encodeURIComponent(scene.path)}" id="scene-group-${act}-${ring}-${idx}">
                                <path id="${sceneId}"
                                      d="${arcPath}" 
                                      fill="${color}" 
                                      stroke="white" 
                                      stroke-width="1" 
                                      class="scene-path"/>

                                <!-- Scene title path (using only the text part) -->
                                <path id="textPath-${act}-${ring}-${idx}" 
                                      d="M ${formatNumber(textPathRadius * Math.cos(sceneStartAngle + 0.02))} ${formatNumber(textPathRadius * Math.sin(sceneStartAngle + 0.02))} 
                                         A ${formatNumber(textPathRadius)} ${formatNumber(textPathRadius)} 0 0 1 ${formatNumber(textPathRadius * Math.cos(sceneEndAngle))} ${formatNumber(textPathRadius * Math.sin(sceneEndAngle))}" 
                                      fill="none"/>
                                <text class="scene-title" style="font-size: ${fontSize}px" dy="${dyOffset}">
                                    <textPath href="#textPath-${act}-${ring}-${idx}" startOffset="4">
                                        ${text}
                                    </textPath>
                                </text>
                            </g>`;
                        });
                    } else {
                        // Create 4 dummy scenes for empty subplot rings
                        const dummyScenes = 4;
                        for (let idx = 0; idx < dummyScenes; idx++) {
                            const sceneStartAngle = startAngle + (idx * (endAngle - startAngle) / dummyScenes);
                            const sceneEndAngle = startAngle + ((idx + 1) * (endAngle - startAngle) / dummyScenes);
                            
                            // Construct the arc path for the dummy scene
                            const arcPath = `
                                M ${formatNumber(innerR * Math.cos(sceneStartAngle))} ${formatNumber(innerR * Math.sin(sceneStartAngle))}
                                L ${formatNumber(outerR * Math.cos(sceneStartAngle))} ${formatNumber(outerR * Math.sin(sceneStartAngle))}
                                A ${formatNumber(outerR)} ${formatNumber(outerR)} 0 0 1 ${formatNumber(outerR * Math.cos(sceneEndAngle))} ${formatNumber(outerR * Math.sin(sceneEndAngle))}
                                L ${formatNumber(innerR * Math.cos(sceneEndAngle))} ${formatNumber(innerR * Math.sin(sceneEndAngle))}
                                A ${formatNumber(innerR)} ${formatNumber(innerR)} 0 0 0 ${formatNumber(innerR * Math.cos(sceneStartAngle))} ${formatNumber(innerR * Math.sin(sceneStartAngle))}
                            `;

                            svg += `<path d="${arcPath}" 
                                     fill="${this.lightenColor(PUBLISH_STAGE_COLORS.Zero, 50)}" 
                                     stroke="white" 
                                     stroke-width="1" 
                                     class="scene-path"/>`;
                        }
                    }
                } else {
                    // Empty subplot code
                    const arcPath = `
                        M ${formatNumber(innerR * Math.cos(startAngle))} ${formatNumber(innerR * Math.sin(startAngle))}
                        L ${formatNumber(outerR * Math.cos(startAngle))} ${formatNumber(outerR * Math.sin(startAngle))}
                        A ${formatNumber(outerR)} ${formatNumber(outerR)} 0 0 1 ${formatNumber(outerR * Math.cos(endAngle))} ${formatNumber(outerR * Math.sin(endAngle))}
                        L ${formatNumber(innerR * Math.cos(endAngle))} ${formatNumber(innerR * Math.sin(endAngle))}
                        A ${formatNumber(innerR)} ${formatNumber(innerR)} 0 0 0 ${formatNumber(innerR * Math.cos(startAngle))} ${formatNumber(innerR * Math.sin(startAngle))}
                    `;
                    const emptyColor = this.lightenColor(PUBLISH_STAGE_COLORS.Zero, 50); // Lighter purple/Zero color
                    svg += `<path d="${arcPath}" fill="${emptyColor}" stroke="white" stroke-width="1"/>`;
                }
            }
        }

        // After all scenes are drawn, add just the act borders (vertical lines only)
        for (let act = 0; act < NUM_ACTS; act++) {
            const angle = (act * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
            
            // Draw only the vertical line (y-axis spoke) for each act boundary
            svg += `<line 
                x1="${formatNumber(innerRadius * Math.cos(angle))}" 
                y1="${formatNumber(innerRadius * Math.sin(angle))}"
                x2="${formatNumber(outerRadius * Math.cos(angle))}" 
                y2="${formatNumber(outerRadius * Math.sin(angle))}"
                class="act-border"
            />`;
        }

        // Calculate the actual outermost outerRadius (first ring's outer edge)
        const actualOuterRadius = ringStartRadii[NUM_RINGS - 1] + ringWidths[NUM_RINGS - 1];
       
        // Remove the old act code and replace it with this new version:
        for (let act = 0; act < NUM_ACTS; act++) {
            // Calculate angle for each act's starting position
            const angle = (act * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
            
            // Position labels slightly to the left of the vertical borders
            const actLabelRadius = actualOuterRadius + 14;
            const angleOffset = -0.08; // Positive offset moves text clockwise
            
            // Calculate start and end angles for the curved path
            const startAngle = angle + angleOffset;
            const endAngle = startAngle + (Math.PI / 12); // Reduced arc length
            
            const actPathId = `actPath-${act}`;
            
            // Create the curved path for act label
            svg += `
                <path id="${actPathId}"
                    d="
                        M ${formatNumber(actLabelRadius * Math.cos(startAngle))} ${formatNumber(actLabelRadius * Math.sin(startAngle))}
                        A ${formatNumber(actLabelRadius)} ${formatNumber(actLabelRadius)} 0 0 1 ${formatNumber(actLabelRadius * Math.cos(endAngle))} ${formatNumber(actLabelRadius * Math.sin(endAngle))}
                    "
                    fill="none"
                />
                <text class="act-label">
                    <textPath href="#${actPathId}" startOffset="0" text-anchor="start">
                        ACT ${act + 1}
                    </textPath>
                </text>
            `;
        }

        // Add color key with decorative elements
        const keyX = size/2 - 200; // Position from right edge
        const keyY = -size/2 + 50; // Position from top
        const swatchSize = 20;
        const textOffset = 30;
        const lineHeight = 30;

        // Calculate the number of scenes for each status using a Set to track unique scenes
        const processedScenes = new Set<string>(); // Track scenes by their path
        const statusCounts = scenes.reduce((acc, scene) => {
            // Skip if we've already processed this scene
            if (processedScenes.has(scene.path)) {
                return acc;
            }
            
            // Mark scene as processed
            processedScenes.add(scene.path);
            
            const normalizedStatus = scene.status?.toString().trim().toLowerCase() || '';
            
            if (normalizedStatus === "complete") {
                // For completed scenes, count by Publish Stage
                const publishStage = scene["Publish Stage"] || 'Zero';
                // Use the publishStage directly with type safety
                const validStage = publishStage as keyof typeof PUBLISH_STAGE_COLORS;
                acc[validStage] = (acc[validStage] || 0) + 1;
            } else if (scene.due && new Date() > new Date(scene.due)) {
                // Non-complete scenes that are past due date are counted as Due
                acc["Due"] = (acc["Due"] || 0) + 1;
            } else {
                // All other scenes are counted by their status
                acc[scene.status] = (acc[scene.status] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);

        // Add center color key
        const centerRadius = innerRadius * 0.7; // Slightly smaller than innerRadius
        const centerKeySize = 20; // Size of color swatches
        const centerLineHeight = 35;

        // Separate stage colors and status colors
        const stageColorEntries = Object.entries(PUBLISH_STAGE_COLORS);
        const statusColorEntries = Object.entries(STATUS_COLORS)
            .filter(([status]) => status !== 'Empty' && status !== 'Complete');

        // Calculate heights for alignment
        const maxEntries = Math.max(stageColorEntries.length, statusColorEntries.length);
        const totalHeight = maxEntries * centerLineHeight;
        const startY = -totalHeight / 2 + centerLineHeight / 2;

        svg += `
            <g class="color-key-center">
                <!-- Stage colors column (left) -->
                ${stageColorEntries.map(([stage, color], index) => {
                    const yPos = startY + (index * centerLineHeight);
                    return `
                        <g transform="translate(-25, ${yPos})">
                            <!-- Stage label with right justification -->
                            <text 
                                x="-10" 
                                y="0" 
                                dominant-baseline="middle" 
                                text-anchor="end"
                                class="center-key-text"
                            >${stage.toUpperCase()} <tspan style="font-size: 14px; opacity: 0.7; baseline-shift: super;">${statusCounts[stage] || 0}</tspan></text>
                            
                            <!-- Color SWATCH to the right of text -->
                            <rect 
                                x="-3" 
                                y="-13" 
                                width="25" 
                                height="25" 
                                fill="${color}"
                            />
                        </g>
                    `;
                }).join('')}

                <!-- Status colors column (right) -->
                ${statusColorEntries.map(([status, color], index) => {
                    const yPos = startY + (index * centerLineHeight);
                    
                    // Check if this is Working or Todo status to show plaid pattern
                    const isWorkingOrTodo = status === 'Working' || status === 'Todo';
                    const fillValue = isWorkingOrTodo ? 
                        `url(#plaid${status}Zero)` : // Use the Zero publishing stage for the legend
                        color;
                    
                    return `
                        <g transform="translate(25, ${yPos})">
                            <!-- Color SWATCH first (left) -->
                            <rect 
                                x="-20" 
                                y="-13" 
                                width="25" 
                                height="25" 
                                fill="${fillValue}"
                            />
                            
                            <!-- Status label with left justification -->
                            <text 
                                x="10" 
                                y="0" 
                                dominant-baseline="middle" 
                                text-anchor="start"
                                class="center-key-text"
                            >${status.toUpperCase()} <tspan style="font-size: 14px; opacity: 0.7; baseline-shift: super;">${statusCounts[status] || 0}</tspan></text>
                        </g>
                    `;
                }).join('')}
            </g>
        `;

        // Add number squares after all other elements but before synopses
        svg += `<g class="number-squares">`;
        scenes.forEach((scene) => {
            const { number } = parseSceneTitle(scene.title);
            if (number) {
                const subplotIndex = masterSubplotOrder.indexOf(scene.subplot);
                const ring = NUM_RINGS - 1 - subplotIndex;
                
                // Get the scenes for this act and subplot to determine correct index
                const scenesInActAndSubplot = scenesByActAndSubplot[scene.actNumber - 1][scene.subplot] || [];
                const sceneIndex = scenesInActAndSubplot.indexOf(scene);
                
                const act = scene.actNumber - 1;
                const startAngle = (act * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
                const endAngle = ((act + 1) * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
                const sceneAngleSize = (endAngle - startAngle) / scenesInActAndSubplot.length;
                const sceneStartAngle = startAngle + (sceneIndex * sceneAngleSize);
                
                const textPathRadius = (ringStartRadii[ring] + (ringStartRadii[ring] + ringWidths[ring])) / 2;
                
                // Reuse the existing square size calculation
                const getSquareSize = (num: string): { width: number, height: number } => {
                    const height = 18;
                    if (num.includes('.')) {
                        return {
                            width: num.length <= 3 ? 24 :
                                    num.length <= 4 ? 32 :
                                    36,
                            height: height
                        };
                    } else {
                        return {
                            width: num.length === 1 ? 20 :
                                    num.length === 2 ? 24 :
                                    28,
                            height: height
                        };
                    }
                };

                const squareSize = getSquareSize(number);
                const squareX = textPathRadius * Math.cos(sceneStartAngle) + 2;
                const squareY = textPathRadius * Math.sin(sceneStartAngle) + 2;
          
                // Store scene number information for square and synopsis
                const sceneId = `scene-path-${act}-${ring}-${sceneIndex}`;
                sceneNumbersMap.set(sceneId, {
                    number,
                    x: squareX,
                    y: squareY,
                    width: squareSize.width,
                    height: squareSize.height
                });

                // Determine colors based on Edits metadata
                const hasEdits = scene.Edits && scene.Edits.trim() !== '';
                const squareBackgroundColor = hasEdits ? "#8875ff" : "white";
                const textColor = hasEdits ? "white" : "black";

                svg += `
                    <g transform="translate(${squareX}, ${squareY})">
                        <rect 
                            x="-${squareSize.width/2}" 
                            y="-${squareSize.height/2}" 
                            width="${squareSize.width}" 
                            height="${squareSize.height}" 
                            fill="${squareBackgroundColor}" 
                            class="number-square"
                            data-scene-id="${sceneId}"
                        />
                        <text 
                            x="0" 
                            y="0" 
                            text-anchor="middle" 
                            dominant-baseline="middle" 
                            class="number-text"
                            data-scene-id="${sceneId}"
                            dy="0.1em"
                            fill="${textColor}"
                        >${number}</text>
                    </g>
                `;
            }
        });
        svg += `</g>`;
        
        // Add all synopses at the end of the SVG
        svg += `            <g class="synopses-container">
                ${synopsesHTML.join('\n')}
            </g>
        `;

        // Add JavaScript to handle synopsis visibility
        const scriptSection = `
        <script>
            document.querySelectorAll('.scene-group').forEach(sceneGroup => {
                const scenePath = sceneGroup.querySelector('.scene-path');
                const sceneId = scenePath.id;
                const synopsis = document.querySelector(\`.scene-info[data-for-scene="\${sceneId}"]\`);
                
                sceneGroup.addEventListener('mouseenter', () => {
                    if (synopsis) {
                        synopsis.style.opacity = '1';
                        synopsis.style.pointerEvents = 'all';
                    }
                });
                
                sceneGroup.addEventListener('mouseleave', () => {
                    if (synopsis) {
                        synopsis.style.opacity = '0';
                        synopsis.style.pointerEvents = 'none';
                    }
                });
            });
        </script>`;

        svg += `
            ${scriptSection}
        </svg>`;
        return svg;
    }
    private darkenColor(color: string, percent: number): string {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max((num >> 16) - amt, 0);
        const G = Math.max(((num >> 8) & 0x00FF) - amt, 0);
        const B = Math.max((num & 0x0000FF) - amt, 0);
        return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
    }

    private lightenColor(color: string, percent: number): string {
        // Parse the color
        const num = parseInt(color.replace("#", ""), 16);
        
        // Extract original RGB values
        const R = (num >> 16);
        const G = ((num >> 8) & 0x00FF);
        const B = (num & 0x0000FF);
        
        // Calculate lightened values
        const mixRatio = Math.min(1, percent / 100); // How much white to mix in
        
        // Simple lightening calculation that preserves the hue
        const newR = Math.min(255, Math.round(R + (255 - R) * mixRatio));
        const newG = Math.min(255, Math.round(G + (255 - G) * mixRatio));
        const newB = Math.min(255, Math.round(B + (255 - B) * mixRatio));
        
        return "#" + (1 << 24 | newR << 16 | newG << 8 | newB).toString(16).slice(1);
    }

    /// Helper function to split text into balanced lines
    private splitIntoBalancedLines(text: string, maxWidth: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine: string[] = [];
        let currentLength = 0;
        const targetCharsPerLine = 60; // Approximately 60 characters per line for 500px width

        for (let word of words) {
            // Add 1 for the space after the word
            const wordLength = word.length + 1;
            
            if (currentLength + wordLength > targetCharsPerLine) {
                if (currentLine.length > 0) {
                    lines.push(currentLine.join(' '));
                    currentLine = [word];
                    currentLength = wordLength;
                } else {
                    // If a single word is longer than the line length, force it onto its own line
                    currentLine.push(word);
                    lines.push(currentLine.join(' '));
                    currentLine = [];
                    currentLength = 0;
                }
            } else {
                currentLine.push(word);
                currentLength += wordLength;
            }
        }

        if (currentLine.length > 0) {
            lines.push(currentLine.join(' '));
        }

        return lines;
    }

    // Add a helper method for hyphenation
    private hyphenateWord(word: string, maxWidth: number, charWidth: number): [string, string] {
        const maxChars = Math.floor(maxWidth / charWidth);
        if (word.length <= maxChars) return [word, ''];
        
        // Simple hyphenation at maxChars-1 to account for hyphen
        const firstPart = word.slice(0, maxChars - 1) + '-';
        const secondPart = word.slice(maxChars - 1);
        return [firstPart, secondPart];
    }

    private formatSynopsis(text: string, innerRadius: number, fontSize: number): string {
        const maxTextWidth = innerRadius * 2; // Maximum width of text block (fits within the inner void)
        const maxWordsPerLine = 7; // Adjust this for line balancing (approx. number of words per line)
    
        // Split text into lines with balanced word count
        const lines = this.splitIntoBalancedLines(text, maxWordsPerLine);
    
        // Calculate character width dynamically based on font size
        const characterWidth = 0.6 * fontSize; // Average character width multiplier
    
        // Prepare the formatted text to render inside the SVG
        return lines.map((line, i) => {
            const spaceCount = line.split(' ').length - 1;
            const lineWidth = line.length * characterWidth;
            const extraSpace = maxTextWidth - lineWidth;
    
            // Justify the text only if there's extra space and lines are more than one
            if (lineWidth < maxTextWidth && lines.length > 1 && spaceCount > 0 && extraSpace > 0) {
                const spacesNeeded = extraSpace / spaceCount;
                line = line.split(' ').join(' '.repeat(Math.ceil(spacesNeeded)));
                if (spacesNeeded < 0) {
                    this.log(`Negative spacesNeeded for line: "${line}"`);
                }
            }
    
            return `<text class="synopsis-text" x="0" y="${20 + i * 25}" text-anchor="middle">${line}</text>`;
        }).join(' ');
    
    }


    private formatSubplot(subplots: string): string {
        // Split the subplots into separate lines if there are multiple subplots
        const subplotsList = subplots.split(',').map(subplot => subplot.trim());
        return subplotsList.map((subplot, i) => {
            return `<text class="subplot-text" x="0" y="${-20 + i * 25}" text-anchor="middle">${subplot}</text>`;
        }).join(' ');
    }

    async createTimelineHTML(title: string, scenes: Scene[]): Promise<void> {
        try {
            const folderPath = 'Outline';
            if (!(await this.app.vault.adapter.exists(folderPath))) {
                await this.app.vault.createFolder(folderPath);
            }
    
            const htmlPath = `${folderPath}/${title}.html`;
            const html = `<!DOCTYPE html>
    <html>
    <head>
        <title>Manuscript Timeline</title>
        <style>
            :root {
                /* Default variables that will be overridden by Obsidian theme */
                --background-primary: transparent;
                --background-secondary: transparent;
                --text-normal: #333333;
                --text-muted: #666666;
                --text-faint: #999999;
                --text-accent: #705dcf;
                --text-accent-hover: #8875ff;
                --background-modifier-border: #ddd;
            }
            
            html, body {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100%;
                overflow: auto;
                font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
                background-color: transparent !important;
                color: var(--text-normal);
            }
            
            body { 
                display: grid; 
                place-items: center; 
                background-color: transparent !important;
            }
            
            #timeline-container {
                width: 100%;
                height: 100%;
                display: grid;
                place-items: center;
                background-color: transparent !important;
            }
            
            svg {
                max-width: 100%;
                max-height: 100%;
                width: 100vw;
                height: 100vh;
                object-fit: contain;
                background-color: transparent !important;
            }

            /* New CSS classes for faded and highlighted states */
            .scene-path.faded {
                opacity: 0.5;
                transition: opacity 0.2s ease-out;
            }

            .scene-path.highlighted {
                opacity: 1;
                transition: opacity 0.2s ease-out;
            }
            
            /* Ensure key-text elements are styled correctly */
            .theme-dark .key-text {
                fill: #ffffff !important;
            }
            
            .theme-light .key-text {
                fill: #333333 !important;
            }
            
            /* Always keep info-text dark for better visibility against light background */
            .info-text {
                fill: #333333 !important;
            }
        </style>
    </head>
    <body>
        <div id="timeline-container">
            ${this.createTimelineSVG(scenes)}
        </div>
        <script>
            // Helper function to lighten a color
            function lightenColor(color, percent) {
                // Parse the color
                const num = parseInt(color.replace("#", ""), 16);
                
                // Extract original RGB values
                const R = (num >> 16);
                const G = ((num >> 8) & 0x00FF);
                const B = (num & 0x0000FF);
                
                // Calculate lightened values
                const mixRatio = Math.min(1, percent / 100); // How much white to mix in
                
                // Simple lightening calculation that preserves the hue
                const newR = Math.min(255, Math.round(R + (255 - R) * mixRatio));
                const newG = Math.min(255, Math.round(G + (255 - G) * mixRatio));
                const newB = Math.min(255, Math.round(B + (255 - B) * mixRatio));
                
                return "#" + (1 << 24 | newR << 16 | newG << 8 | newB).toString(16).slice(1);
            }
            
            // Function to apply Obsidian theme variables to the iframe content
            function applyThemeVariables() {
                try {
                    // Get the parent document (Obsidian)
                    const parentDocument = window.parent.document;
                    
                    // Check if dark mode is active
                    const isDarkMode = parentDocument.body.classList.contains('theme-dark');
                    
                    // Get computed styles from parent
                    const computedStyle = window.getComputedStyle(parentDocument.documentElement);
                    
                    // List of variables to copy from Obsidian
                    const variables = [
                        '--background-primary',
                        '--background-secondary',
                        '--text-normal',
                        '--text-muted',
                        '--text-faint',
                        '--text-accent',
                        '--text-accent-hover',
                        '--background-modifier-border'
                    ];
                    
                    // Apply each variable to this document
                    variables.forEach(variable => {
                        const value = computedStyle.getPropertyValue(variable);
                        if (value) {
                            document.documentElement.style.setProperty(variable, value);
                        }
                    });
                    
                    // Add theme class to body
                    document.body.classList.remove('theme-dark', 'theme-light');
                    document.body.classList.add(isDarkMode ? 'theme-dark' : 'theme-light');
                    
                    // Force text color based on theme
                    const textColor = isDarkMode ? '#ffffff' : '#333333';
                    
                    // Force SVG text elements to use explicit colors based on theme
                    const textElements = document.querySelectorAll('.month-label, .month-label-outer, .act-label, .center-number-text');
                    
                    textElements.forEach(el => {
                        el.style.fill = textColor;
                    });
                    
                    // Handle key-text elements separately with a more specific approach
                    document.querySelectorAll('g.color-key text.key-text').forEach(el => {
                        // Use setAttribute to ensure the style is applied
                        el.setAttribute('fill', textColor);
                        // Also set the style.fill property
                        el.style.fill = textColor;
                    });
                    
                    // Handle center key text elements with similar approach
                    document.querySelectorAll('g.color-key-center text.center-key-text').forEach(el => {
                        // Use setAttribute to ensure the style is applied
                        el.setAttribute('fill', textColor);
                        // Also set the style.fill property
                        el.style.fill = textColor;
                    });
                    
                    // Keep info-text elements dark for better visibility against light background
                    document.querySelectorAll('.info-text').forEach(el => {
                        // Always use dark text for info panels
                        el.style.fill = '#333333';
                    });
                    
                    // Force SVG lines to use theme colors
                    document.querySelectorAll('.month-spoke-line:not(.act-boundary)')
                        .forEach(el => {
                            el.style.stroke = textColor;
                        });
                    
                    document.querySelectorAll('.month-spoke-line.act-boundary, .act-border')
                        .forEach(el => {
                            el.style.stroke = computedStyle.getPropertyValue('--text-accent') || '#705dcf';
                        });
                    
                    // Force progress ring to use theme colors
                    const progressBase = document.querySelector('.progress-ring-base');
                    if (progressBase) {
                        progressBase.style.stroke = isDarkMode ? '#444444' : '#dddddd';
                    }
                    
                    // Remove the code that overwrites the rainbow gradient
                    // We want to keep the rainbow gradient applied in the SVG
                    /* 
                    const progressFill = document.querySelector('.progress-ring-fill');
                    if (progressFill) {
                        progressFill.style.stroke = computedStyle.getPropertyValue('--text-accent-hover') || '#8875ff';
                    }
                    */
                    
                    console.log('Theme applied: ' + (isDarkMode ? 'dark' : 'light'));
                } catch (error) {
                    console.error('Error applying theme variables:', error);
                }
            }
            
            // Apply theme variables when the page loads
            window.addEventListener('load', applyThemeVariables);
            
            // Set up observer to detect theme changes in Obsidian
            try {
                const parentBody = window.parent.document.body;
                const observer = new MutationObserver(mutations => {
                    mutations.forEach(mutation => {
                        if (mutation.attributeName === 'class') {
                            // Theme might have changed, reapply variables
                            setTimeout(applyThemeVariables, 100);
                        }
                    });
                });
                
                // Start observing the parent body for class changes
                observer.observe(parentBody, { attributes: true });
            } catch (error) {
                console.error('Error setting up theme observer:', error);
            }
            
            // JavaScript to handle hover and click effects
            const sceneGroups = document.querySelectorAll('.scene-group');
            const ZERO_COLOR = "${this.settings.publishStageColors.Zero}"; // Store Zero color for calculations
            const EMPTY_COLOR = lightenColor(ZERO_COLOR, 50); // Dynamically calculate empty color based on Zero
            
            sceneGroups.forEach(scene => {
                scene.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const path = decodeURIComponent(scene.getAttribute('data-path'));
                    
                    try {
                        const file = window.parent.app.vault.getAbstractFileByPath(path);
                        if (file) {
                            await window.parent.app.workspace.getLeaf().openFile(file);
                        }
                    } catch (error) {
                        console.error('Error opening file:', error);
                    }
                });

                scene.addEventListener('mouseenter', (e) => {
                    // Add reveal functionality
                    const path = decodeURIComponent(scene.getAttribute('data-path'));
                    if (window.parent.app) {
                        const fileExplorer = window.parent.app.workspace.getLeavesOfType('file-explorer')[0];
                        if (fileExplorer) {
                            try {
                                const file = window.parent.app.vault.getAbstractFileByPath(path);
                                if (file) {
                                    fileExplorer.view.revealInFolder(file);
                                }
                            } catch (e) {
                                console.error('Error revealing file:', e);
                            }
                        }
                    }

                    const scenePathId = scene.querySelector('.scene-path').id;
                    
                    // Store original colors and change others to Empty color
                    sceneGroups.forEach(s => {
                        const path = s.querySelector('.scene-path');
                        if (path.id !== scenePathId) {
                            // Store the original color if not already stored
                            if (!path.getAttribute('data-original-color')) {
                                const currentFill = path.getAttribute('fill');
                                // Store the full pattern URL or color
                                path.setAttribute('data-original-color', currentFill);
                            }
                            path.setAttribute('fill', EMPTY_COLOR);
                        }
                        
                        const title = s.querySelector('.scene-title');
                        if (title && path.id !== scenePathId) {
                            title.classList.add('faded');
                        }
                    });

                    // Fade all number squares and text except for the current scene
                    document.querySelectorAll('.number-square, .number-text').forEach(element => {
                        if (element.getAttribute('data-scene-id') !== scenePathId) {
                            element.classList.add('faded');
                            // For squares with purple background, change to white with black text when faded
                            if (element.classList.contains('number-square')) {
                                element.setAttribute('data-original-fill', element.getAttribute('fill'));
                                element.setAttribute('fill', 'white');
                            }
                            if (element.classList.contains('number-text')) {
                                element.setAttribute('data-original-fill', element.getAttribute('fill'));
                                element.setAttribute('fill', 'black');
                            }
                        }
                    });
                });

                scene.addEventListener('mouseleave', () => {
                    // Restore original colors
                    sceneGroups.forEach(s => {
                        const path = s.querySelector('.scene-path');
                        const originalColor = path.getAttribute('data-original-color');
                        if (originalColor) {
                            path.setAttribute('fill', originalColor);
                            path.removeAttribute('data-original-color');
                        }
                        
                        const title = s.querySelector('.scene-title');
                        if (title) title.classList.remove('faded');
                    });

                    // Remove fading and restore original colors for all number squares and text
                    document.querySelectorAll('.number-square, .number-text').forEach(element => {
                        element.classList.remove('faded');
                        const originalFill = element.getAttribute('data-original-fill');
                        if (originalFill) {
                            element.setAttribute('fill', originalFill);
                            element.removeAttribute('data-original-fill');
                        }
                    });
                });
            });
        </script>
    </body>
    </html>`;
    
            await this.app.vault.adapter.write(htmlPath, html);
    
        } catch (error) {
            this.log("Error creating timeline:", error);
            throw error;
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Add this helper function at the class level
    private parseSceneTitle(title: string): { number: string; cleanTitle: string } {
        // Split on first space
        const parts = title.trim().split(/\s+(.+)/);
        
        // Check if first part is a valid number
        if (parts.length > 1 && !isNaN(parseFloat(parts[0]))) {
            return {
                number: parts[0],
                cleanTitle: parts[1]
            };
        }
        return {
            number: "",
            cleanTitle: title.trim()
        };
    }

    private log(message: string, data?: any) {
        const console = (window as any).console;
        if (console) {
            if (data) {
                console.log(`Manuscript Timeline Plugin: ${message}`, data);
            } else {
                console.log(`Manuscript Timeline Plugin: ${message}`);
            }
        }
    }
}

class ManuscriptTimelineSettingTab extends PluginSettingTab {
    plugin: ManuscriptTimelinePlugin;

    constructor(app: App, plugin: ManuscriptTimelinePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Add plugin settings
        containerEl.createEl('h2', { text: 'Manuscript Timeline Settings' });

        new Setting(containerEl)
            .setName('Source Path')
            .setDesc('Path to folder containing scene files')
            .addText(text => text
                .setPlaceholder('Enter path')
                .setValue(this.plugin.settings.sourcePath)
                .onChange(async (value) => {
                    this.plugin.settings.sourcePath = value;
                    await this.plugin.saveSettings();
                }));
        
        // Add publish stage color settings
        containerEl.createEl('h3', { text: 'Publishing Stage Colors' });
        
        // Helper function to create a color swatch
        const createColorSwatch = (container: HTMLElement, color: string) => {
            const swatch = container.createEl('div');
            swatch.style.backgroundColor = color;
            swatch.style.width = '30px';
            swatch.style.height = '30px';
            swatch.style.border = '1px solid #ccc';
            swatch.style.borderRadius = '4px';
            swatch.style.display = 'inline-block';
            swatch.style.marginLeft = '10px';
            return swatch;
        };
        
        // Zero stage color
        let zeroColorSwatch: HTMLElement;
        let zeroColorSetting = new Setting(containerEl)
            .setName('Zero Stage Color')
            .setDesc('Color for Zero publishing stage (changing this will affect empty scenes too)')
            .addText(text => {
                const textComponent = text
                    .setPlaceholder('#9E70CF')
                    .setValue(this.plugin.settings.publishStageColors.Zero)
                    .onChange(async (value) => {
                        this.plugin.settings.publishStageColors.Zero = value;
                        await this.plugin.saveSettings();
                        zeroColorSwatch.style.backgroundColor = value;
                    });
                return textComponent;
            });
        
        // Add swatch after creating the setting
        zeroColorSwatch = createColorSwatch(zeroColorSetting.controlEl, this.plugin.settings.publishStageColors.Zero);
        
        zeroColorSetting.addExtraButton(button => {
            button
                .setIcon('reset')
                .setTooltip('Reset to default')
                .onClick(async () => {
                    this.plugin.settings.publishStageColors.Zero = DEFAULT_SETTINGS.publishStageColors.Zero;
                    await this.plugin.saveSettings();
                    const textComponent = zeroColorSetting.components[0] as any;
                    textComponent.setValue(DEFAULT_SETTINGS.publishStageColors.Zero);
                    zeroColorSwatch.style.backgroundColor = DEFAULT_SETTINGS.publishStageColors.Zero;
                });
        });
            
        // Author stage color
        let authorColorSwatch: HTMLElement;
        let authorColorSetting = new Setting(containerEl)
            .setName('Author Stage Color')
            .setDesc('Color for Author publishing stage')
            .addText(text => {
                const textComponent = text
                    .setPlaceholder('#5E85CF')
                    .setValue(this.plugin.settings.publishStageColors.Author)
                    .onChange(async (value) => {
                        this.plugin.settings.publishStageColors.Author = value;
                        await this.plugin.saveSettings();
                        authorColorSwatch.style.backgroundColor = value;
                    });
                return textComponent;
            });
            
        // Add swatch after creating the setting
        authorColorSwatch = createColorSwatch(authorColorSetting.controlEl, this.plugin.settings.publishStageColors.Author);
        
        authorColorSetting.addExtraButton(button => {
            button
                .setIcon('reset')
                .setTooltip('Reset to default')
                .onClick(async () => {
                    this.plugin.settings.publishStageColors.Author = DEFAULT_SETTINGS.publishStageColors.Author;
                    await this.plugin.saveSettings();
                    const textComponent = authorColorSetting.components[0] as any;
                    textComponent.setValue(DEFAULT_SETTINGS.publishStageColors.Author);
                    authorColorSwatch.style.backgroundColor = DEFAULT_SETTINGS.publishStageColors.Author;
                });
        });
            
        // House stage color
        let houseColorSwatch: HTMLElement;
        let houseColorSetting = new Setting(containerEl)
            .setName('House Stage Color')
            .setDesc('Color for House publishing stage')
            .addText(text => {
                const textComponent = text
                    .setPlaceholder('#DA7847')
                    .setValue(this.plugin.settings.publishStageColors.House)
                    .onChange(async (value) => {
                        this.plugin.settings.publishStageColors.House = value;
                        await this.plugin.saveSettings();
                        houseColorSwatch.style.backgroundColor = value;
                    });
                return textComponent;
            });
            
        // Add swatch after creating the setting
        houseColorSwatch = createColorSwatch(houseColorSetting.controlEl, this.plugin.settings.publishStageColors.House);
        
        houseColorSetting.addExtraButton(button => {
            button
                .setIcon('reset')
                .setTooltip('Reset to default')
                .onClick(async () => {
                    this.plugin.settings.publishStageColors.House = DEFAULT_SETTINGS.publishStageColors.House;
                    await this.plugin.saveSettings();
                    const textComponent = houseColorSetting.components[0] as any;
                    textComponent.setValue(DEFAULT_SETTINGS.publishStageColors.House);
                    houseColorSwatch.style.backgroundColor = DEFAULT_SETTINGS.publishStageColors.House;
                });
        });
            
        // Press stage color
        let pressColorSwatch: HTMLElement;
        let pressColorSetting = new Setting(containerEl)
            .setName('Press Stage Color')
            .setDesc('Color for Press publishing stage')
            .addText(text => {
                const textComponent = text
                    .setPlaceholder('#6FB971')
                    .setValue(this.plugin.settings.publishStageColors.Press)
                    .onChange(async (value) => {
                        this.plugin.settings.publishStageColors.Press = value;
                        await this.plugin.saveSettings();
                        pressColorSwatch.style.backgroundColor = value;
                    });
                return textComponent;
            });
            
        // Add swatch after creating the setting
        pressColorSwatch = createColorSwatch(pressColorSetting.controlEl, this.plugin.settings.publishStageColors.Press);
        
        pressColorSetting.addExtraButton(button => {
            button
                .setIcon('reset')
                .setTooltip('Reset to default')
                .onClick(async () => {
                    this.plugin.settings.publishStageColors.Press = DEFAULT_SETTINGS.publishStageColors.Press;
                    await this.plugin.saveSettings();
                    const textComponent = pressColorSetting.components[0] as any;
                    textComponent.setValue(DEFAULT_SETTINGS.publishStageColors.Press);
                    pressColorSwatch.style.backgroundColor = DEFAULT_SETTINGS.publishStageColors.Press;
                });
        });
        
        // Add a horizontal rule
        containerEl.createEl('hr');
        
        // ABOUT section with merged Features
        containerEl.createEl('h3', { text: 'About Manuscript Timeline' });
        
        containerEl.createEl('p', { 
            text: 'A manuscript timeline for creative fiction writing projects that displays scenes organized by act, subplot, and chronological order in a radial format for a comprehensive view of project.'
        });
        
        // Merged Features into About section
        const featuresList = containerEl.createEl('ul');
        [
            'Creates an interactive radial timeline visualization of your scenes',
            'Organizes scenes by act, subplot, and chronological order',
            'Shows scene details on hover including title, date, synopsis, subplots, and characters',
            'Color-codes scenes by status (Complete, Working, Todo, etc.)',
            'Supports both light and dark themes',
            'Allows clicking on scenes to open the corresponding file'
        ].forEach(feature => {
            featuresList.createEl('li', { text: feature });
        });
        
        // Author information
        containerEl.createEl('p', { 
            text: 'Created by Eric Rhys Taylor'
        });
        
        // Support link - moved up from bottom
        containerEl.createEl('h4', { text: 'Support Development' });
        containerEl.createEl('p', { 
            text: 'If you find this plugin useful, consider supporting its continued development:'
        });
        
        const supportLink = containerEl.createEl('a', { 
            href: 'https://www.buymeacoffee.com/ericrhystaylor'
        });
        supportLink.target = '_blank';
        supportLink.createEl('img', { 
            attr: {
                src: 'https://cdn.buymeacoffee.com/buttons/v2/default-blue.png',
                alt: 'Buy Me A Coffee',
                style: 'height: 60px !important; width: 217px !important;'
            }
        });
        
        // Display Requirements section
        containerEl.createEl('h3', { text: 'Display Requirements' });
        containerEl.createEl('p', { 
            text: 'This plugin creates an information-dense visualization that is more legible on high-resolution displays.'
        });
        const requirementsList = containerEl.createEl('ul');
        [
            'Recommended: High-resolution displays such as Apple Retina displays or Windows equivalent (4K or better)',
            'The timeline contains detailed text and visual elements that benefit from higher pixel density',
            'While usable on standard displays, you may need to zoom in to see all details clearly'
        ].forEach(req => {
            requirementsList.createEl('li', { text: req });
        });
        
        // Required Plugins section
        containerEl.createEl('h3', { text: 'Required Plugins' });
        containerEl.createEl('p', { 
            text: 'This plugin requires the following community plugin for proper operation:'
        });
        
        // HTML Reader plugin description
        const pluginDescription = containerEl.createEl('div', {
            attr: {
                style: 'background: var(--background-secondary-alt); padding: 15px; border-radius: 8px; margin: 10px 0;'
            }
        });
        pluginDescription.createEl('h4', { 
            text: 'HTML Reader by Nuthrash',
            attr: { style: 'margin-top: 0; margin-bottom: 10px;' }
        });
        pluginDescription.createEl('p', { 
            text: 'HTML file reader plugin for Obsidian. Opens documents with ".html" and ".htm" file extensions.'
        });
        
        // Highlight the important setting
        const importantNote = containerEl.createEl('div', {
            attr: {
                style: 'background: var(--background-modifier-error-hover); color: var(--text-error); padding: 10px; border-radius: 4px; margin: 10px 0; font-weight: bold;'
            }
        });
        importantNote.createEl('p', { 
            text: 'IMPORTANT: HTML Reader must be set to "Unrestricted" mode!',
            attr: { style: 'margin: 0;' }
        });
        
        // Setup instructions
        containerEl.createEl('p', { 
            text: 'How to configure HTML Reader:'
        });
        const setupSteps = containerEl.createEl('ol');
        [
            'Install the HTML Reader plugin from Obsidian Community Plugins',
            'Go to Settings → Community plugins → HTML Reader',
            'Under "Operating mode", select "Unrestricted"',
            'This setting is required for proper CSS styling and interactive features'
        ].forEach(step => {
            setupSteps.createEl('li', { text: step });
        });
        
        // How to Use section
        containerEl.createEl('h3', { text: 'How to Use' });
        const usageList = containerEl.createEl('ol');
        [
            'Install the plugin in your Obsidian vault',
            'Configure the source path in the plugin settings to point to your scenes folder',
            'Ensure your scene files have the required frontmatter metadata (see below)',
            'Run the "Create Manuscript Timeline" command using the Command Palette (Cmd/Ctrl+P) to generate the visualization',
            'The timeline will be created in the "Outline" folder as an HTML file',
            'Open the HTML file in Obsidian using the HTML Reader plugin to view and interact with your timeline (make sure HTML Reader is set to Unrestricted mode in its settings)',
            'To update the timeline after making changes to your scene files, run the "Create Manuscript Timeline" command again'
        ].forEach(step => {
            usageList.createEl('li', { text: step });
        });
        
        // Required Metadata section
        containerEl.createEl('h3', { text: 'Required Scene Metadata' });
        containerEl.createEl('p', { 
            text: 'Scene files must have the following frontmatter:'
        });
        const metadataList = containerEl.createEl('ul');
        [
            'Class: Scene - Identifies the file as a scene',
            'When - Date of the scene (required)',
            'Title - Scene title',
            'Subplot - Subplot(s) the scene belongs to',
            'Act - Act number (1-3)',
            'Status - Scene status (Complete, Working, Todo, etc.)',
            'Synopsis - Brief description of the scene',
            'Character - Characters in the scene',
            'Due - Optional due date for the scene',
            'Edits - Optional editing notes (scenes with Edits will display with purple number boxes)',
            'Publish Stage - Publishing stage (Zero, Author, House, Press)'
        ].forEach(meta => {
            metadataList.createEl('li', { text: meta });
        });
        
        // Example metadata
        containerEl.createEl('h4', { text: 'Example Metadata (Use Paste Match Style under Edit Menu)' });
        const exampleCode = containerEl.createEl('pre', {
            attr: {
                style: 'line-height: 1.7; white-space: pre-wrap; overflow-x: auto; padding: 10px; background: var(--background-secondary); border-radius: 4px; user-select: text; cursor: text; font-family: monospace;'
            }
        });
        exampleCode.createEl('code', { 
            attr: {
                style: 'user-select: text;'
            },
            text: `---
Class: Scene
Synopsis: The protagonist discovers a mysterious artifact.
Subplot:
  - The Great War
  - Jinnis Pickle
Act: 1
When: 2023-05-15
Character:
  - John Mars
  - Celon Tim
Place:
  - Diego
  - Earth
Publish Stage: Zero
Status: Complete
Edits:
---`
        });
        
        // Timeline elements section
        containerEl.createEl('h3', { text: 'Timeline Visualization Elements' });
        containerEl.createEl('p', { 
            text: 'The timeline displays:'
        });
        const timelineElementsList = containerEl.createEl('ul');
        [
            'Scenes arranged in a circular pattern',
            'Acts divided into sections',
            'Subplots organized in concentric rings',
            'Scene numbers in small boxes',
            'Color-coded scenes based on status',
            'Month markers around the perimeter',
            'Progress ring showing year progress'
        ].forEach(element => {
            timelineElementsList.createEl('li', { text: element });
        });
        
        containerEl.createEl('p', { 
            text: 'Hover over a scene to see its details and click to open the corresponding file.'
        });
        
        // Add screenshot image
        const screenshotContainer = containerEl.createEl('div', {
            attr: {
                style: 'text-align: center; margin: 20px 0;'
            }
        });
        
        // Create an anchor tag that wraps the image and opens in a new tab
        const screenshotLink = screenshotContainer.createEl('a', {
            attr: {
                href: 'https://raw.githubusercontent.com/ericrhystaylor/obsidian-manuscript-timeline/master/screenshot.png',
                target: '_blank',
                rel: 'noopener',
                style: 'display: inline-block; cursor: pointer;'
            }
        });
        
        // Add the image inside the anchor tag
        screenshotLink.createEl('img', {
            attr: {
                src: 'https://raw.githubusercontent.com/ericrhystaylor/obsidian-manuscript-timeline/master/screenshot.png',
                alt: 'Example Timeline Screenshot',
                style: 'max-width: 100%; border-radius: 8px; border: 1px solid var(--background-modifier-border);'
            }
        });
        
        // Add a small hint text below the image
        screenshotContainer.createEl('div', {
            text: 'Click image to view full size in browser',
            attr: {
                style: 'font-size: 0.8em; margin-top: 5px; color: var(--text-muted);'
            }
        });
        
        // Scene Ordering section
        containerEl.createEl('h3', { text: 'Scene Ordering and Numbering' });
        const orderingList = containerEl.createEl('ul');
        [
            'Scenes are ordered chronologically based on the When date in the frontmatter metadata',
            'The plugin parses scene numbers from the Title prefix (e.g., "1.2" in "1.2 The Discovery")',
            'These numbers are displayed in small boxes on the timeline',
            'Using numbered prefixes in your scene titles helps Obsidian order scenes correctly in the file explorer',
            'If scenes have the same When date, they are sub-ordered by their scene number'
        ].forEach(item => {
            orderingList.createEl('li', { text: item });
        });
        
        // Technical Implementation - D3.js inspiration section (moved to the end)
        containerEl.createEl('h3', { text: 'Technical Implementation' });
        
        containerEl.createEl('p', { 
            text: `The Manuscript Timeline visualization was inspired by and draws on principles from D3.js, a powerful JavaScript library for producing dynamic, interactive data visualizations. While the plugin doesn't directly use the D3 library to reduce dependencies, it implements several D3-style approaches:`
        });
        
        const techList = containerEl.createEl('ul');
        [
            'SVG-based visualization techniques',
            'Data-driven document manipulation',
            'Interactive elements with hover and click behaviors',
            'Radial layouts and polar coordinates',
            'Scale transformations and data mapping',
            'Dynamic color manipulation and pattern generation'
        ].forEach(technique => {
            techList.createEl('li', { text: technique });
        });
        
        containerEl.createEl('p', { 
            text: `The visualizations are built using pure SVG and JavaScript, offering a lightweight solution that maintains the elegance and interactivity of D3-style visualizations while being fully compatible with Obsidian's rendering capabilities.`
        });
        
        // D3.js link
        const d3Link = containerEl.createEl('p');
        const link = d3Link.createEl('a', { 
            text: 'Learn more about D3.js',
            href: 'https://d3js.org/'
        });
        link.target = '_blank';
    }
}