/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * English translations (source of truth)
 * 
 * All keys MUST be defined here. Other locales can provide partial translations
 * and will fall back to English for missing keys.
 * 
 * Naming conventions:
 * - Use dot notation for hierarchy: settings.general.sourcePath.name
 * - 'name' = setting title, 'desc' = setting description
 * - 'heading' = section headings
 * - Use {{variable}} for dynamic content
 */

// Define the shape of translations (allows any string value)
export interface TranslationKeys {
    settings: {
        general: {
            sourcePath: {
                name: string;
                desc: string;
                placeholder: string;
            };
            /** @deprecated Kept for structural compat; not rendered in UI. */
            showTitle: {
                name: string;
                desc: string;
            };
        };
        pov: {
            heading: string;
            vaultDefault: {
                name: string;
                desc: string;
            };
            yamlOverrides: {
                name: string;
                desc: string;
            };
            modes: {
                off: string;
                first: string;
                second: string;
                third: string;
                omni: string;
                objective: string;
            };
            preview: {
                heading: string;
                examples: {
                    sceneFirst: string;
                    sceneThird: string;
                    sceneSecond: string;
                    sceneOmni: string;
                    sceneObjective: string;
                    countTwoThird: string;
                    countThreeThird: string;
                    countFourThird: string;
                    countTwoFirstNumeric: string;
                    countAllFirst: string;
                };
            };
        };
        configuration: {
            heading: string;
            aiOutputFolder: {
                name: string;
                desc: string;
            };
            manuscriptOutputFolder: {
                name: string;
                desc: string;
            };
            synopsisMaxLines: {
                name: string;
                desc: string;
                placeholder: string;
                error: string;
            };
            rippleRename: {
                name: string;
                desc: string;
            };
            autoExpand: {
                name: string;
                desc: string;
            };
            chapterMarkers: {
                name: string;
                desc: string;
            };
            readability: {
                name: string;
                desc: string;
                normal: string;
                large: string;
            };
            showEstimate: {
                name: string;
                desc: string;
            };
            debounce: {
                name: string;
                desc: string;
                placeholder: string;
                error: string;
            };
        };
        ai: {
            heading: string;
            enable: {
                name: string;
                desc: string;
            };
            hero: {
                badgeText: string;
                wikiAriaLabel: string;
                toggleInactive: string;
                toggleActive: string;
                toggleAriaLabel: string;
                titleActive: string;
                titleInactive: string;
                descriptionActive: string;
                highlightsKicker: string;
                featureInquiry: string;
                featurePulse: string;
                featureGossamer: string;
                featureForceMultiplier: string;
            };
            heroOff: {
                descriptionPrimary: string;
                descriptionSecondary: string;
                toolsKicker: string;
                featureInquiry: string;
                featurePulse: string;
                featureGossamer: string;
                featureEnhanced: string;
                muted: string;
            };
            strategy: { title: string; desc: string; };
            costEstimate: { title: string; desc: string; corpusCalculating: string; corpusScanning: string; };
            provider: { name: string; desc: string; optionAnthropic: string; optionOpenai: string; optionGoogle: string; optionLocalLlm: string; };
            modelOverride: { name: string; desc: string; };
            accessTier: { name: string; desc: string; tier1: string; tier2: string; tier3: string; tier4: string; };
            largeHandling: { name: string; };
            roleContext: { title: string; desc: string; };
            apiKeys: { name: string; };
            configuration: { name: string; };
            contextTemplate: { name: string; tooltip: string; };
            preview: { kicker: string; resolving: string; providerPlaceholder: string; };
            secureKey: { unavailableName: string; unavailableDesc: string; migrateName: string; migrateDesc: string; migrateButton: string; noLegacyKeysNotice: string; };
            credential: { statusReady: string; statusRejected: string; statusNetworkBlocked: string; statusChecking: string; statusNotConfigured: string; helperNotConfigured: string; helperRejected: string; helperNetworkBlocked: string; helperChecking: string; replaceKeyButton: string; copyKeyNameButton: string; keyNameCopiedNotice: string; keyNameCopyFailNotice: string; placeholderAnthropic: string; placeholderGoogle: string; placeholderOpenai: string; };
            localLlm: { configTitle: string; configDesc: string; statusTitle: string; statusDesc: string; serverName: string; serverDesc: string; modelsLoading: string; noModelsAuto: string; noModelsCustom: string; legendNotUsable: string; legendLimited: string; legendStrong: string; legendInquiryEligible: string; modelActive: string; actionsName: string; actionsDesc: string; loadServersButton: string; loadModelsButton: string; validateButton: string; loadModelsTooltip: string; };
            localLlmConfig: { serverName: string; serverDesc: string; optionOllama: string; optionLmStudio: string; optionOpenaiCompat: string; baseUrlName: string; baseUrlDesc: string; manualModelName: string; manualModelDesc: string; jsonModeName: string; jsonModeDesc: string; optionJsonModeResponseFormat: string; optionJsonModePromptOnly: string; capabilitiesTitle: string; capabilitiesDesc: string; capabilityReasoningStrongName: string; capabilityReasoningStrongDesc: string; capabilityLongContextName: string; capabilityLongContextDesc: string; capabilityHighOutputCapName: string; capabilityHighOutputCapDesc: string; };
            config: { inquiryTitle: string; citationsName: string; citationsDesc: string; timelineDisplayTitle: string; pulseContextName: string; pulseContextDesc: string; synopsisMaxWordsName: string; synopsisMaxWordsDesc: string; synopsisMaxWordsInvalid: string; summaryRefreshTitle: string; targetSummaryName: string; targetSummaryDesc: string; targetSummaryInvalid: string; weakThresholdName: string; weakThresholdDesc: string; weakThresholdInvalid: string; alsoUpdateSynopsisName: string; alsoUpdateSynopsisDesc: string; };
        };
        progress: {
            heading: string;
            completionEstimate: {
                heading: string;
                scenesComplete: string;
                remaining: string;
                perWeek: string;
                completedFraction: string;
                estimatedCompletion: string;
                daysFromNow: string;
                insufficientData: string;
                projectionHeading: string;
                projectionHeadingLastPace: string;
                lastProgress: string;
            };
        };
        chronologue: {
            heading: string;
        };
        storyBeats: {
            heading: string;
        };
        colors: {
            heading: string;
        };
        beats: {
            acts: { name: string };
            actCount: { name: string; desc: string; placeholder: string };
            actLabels: { name: string; desc: string; placeholder: string };
            storyBeatsSystem: { name: string };
            systemEditModal: {
                badge: string;
                title: string;
                subtitle: string;
                nameLabel: string;
                namePlaceholder: string;
                descLabel: string;
                descPlaceholder: string;
                nameRequiredNotice: string;
                nameLettersNotice: string;
                saveText: string;
                cancelText: string;
            };
            design: {
                builtInTag: string;
                starterTag: string;
                savedTag: string;
                builtInTagTooltip: string;
                starterTagTooltip: string;
                savedTagTooltip: string;
                builtInDirtyTooltip: string;
                starterDirtyTooltip: string;
                savedDirtyTooltip: string;
                modifiedLabel: string;
                guidance: string;
                beatNamesNotice: string;
                beatNameNotice: string;
                beatNamePlaceholder: string;
                newBeatPlaceholder: string;
                addBeatAriaLabel: string;
                dragTooltip: string;
                rangeTooltip: string;
                setSavedNotice: string;
                noActiveSystemNotice: string;
            };
            stages: {
                preview: string;
                design: string;
                fields: string;
            };
            beatNotes: {
                name: string;
                desc: string;
                createText: string;
                createTooltip: string;
                repairText: string;
                repairTooltip: string;
            };
            beatFields: {
                name: string;
                desc: string;
                baseFieldsHeading: string;
                customFieldsHeading: string;
                dragTooltip: string;
                iconPlaceholder: string;
                iconTooltip: string;
                hoverCheckboxTooltip: string;
                keyPlaceholder: string;
                keyRequiredNotice: string;
                baseFieldNotice: string;
                legacyKeyNotice: string;
                keyExistsNotice: string;
                commaSeparatedPlaceholder: string;
                defaultValuePlaceholder: string;
                removeFieldLabel: string;
                newKeyPlaceholder: string;
                valuePlaceholder: string;
                addPropertyTooltip: string;
                revertTooltip: string;
            };
            resetModal: {
                badge: string;
                title: string;
                subtitle: string;
                confirmText: string;
                resetText: string;
                cancelText: string;
            };
            hoverPreview: {
                heading: string;
                headingNoneEnabled: string;
                enableHint: string;
            };
            library: {
                heading: string;
                desc: string;
                addSystemLabel: string;
                selectLabel: string;
                narrativeGroup: string;
                engineGroup: string;
                formatGroup: string;
                savedGroup: string;
                blankGroup: string;
                blankSystemTag: string;
                librarySystemTag: string;
                savedSystemTag: string;
                loadedStatus: string;
                activeStatus: string;
                createBlankText: string;
                focusTabText: string;
                openTabText: string;
                saveAsCopyText: string;
                resetToDefaultText: string;
            };
            deleteModal: {
                subtitleWithNotes: string;
                scopePrefix: string;
                beatNote: string;
                warningExtra: string;
                warningTemplate: string;
                typeDeletePrompt: string;
                cancelText: string;
            };
            saveModal: {
                badge: string;
                copyTitle: string;
                saveTitle: string;
                copySubtitle: string;
                saveSubtitle: string;
                namePlaceholder: string;
                saveText: string;
                cancelText: string;
                beatNamesNotice: string;
                noBeatsNotice: string;
                nameRequiredNotice: string;
            };
            backdrop: {
                name: string;
                desc: string;
                showLabel: string;
                hideLabel: string;
                iconTooltip: string;
                hoverCheckboxTooltip: string;
                addFieldTooltip: string;
                revertTooltip: string;
                systemManagedNotice: string;
                baseFieldNotice: string;
                legacyKeyNotice: string;
                hoverPreviewHeading: string;
                hoverPreviewNoneEnabled: string;
                hoverPreviewEnableHint: string;
            };
            audit: {
                copyTooltip: string;
                copiedNotice: string;
                insertFieldsText: string;
                insertFieldsTooltip: string;
                insertIdsText: string;
                insertIdsTooltip: string;
                fixDuplicateIdsText: string;
                fixDuplicateIdsTooltip: string;
                fillEmptyText: string;
                fillEmptyTooltip: string;
                migrateDeprecatedText: string;
                migrateDeprecatedTooltip: string;
                removeUnusedText: string;
                removeUnusedTooltip: string;
                deleteCustomText: string;
                deleteCustomTooltip: string;
                reorderText: string;
                reorderTooltip: string;
                saveChangesText: string;
                saveChangesTooltip: string;
                checkNotesText: string;
                healthClean: string;
                healthMixed: string;
                healthNeedsAttention: string;
                healthCritical: string;
                healthUnsafe: string;
            };
        };
        runtime: {
            header: { name: string; desc: string; badgeText: string; };
            contentType: { name: string; desc: string; optionNovel: string; optionScreenplay: string; };
            dialogueWpm: { name: string; desc: string; };
            actionWpm: { name: string; desc: string; };
            parenthetical: {
                beat: { name: string; desc: string; };
                pause: { name: string; desc: string; };
                longPause: { name: string; desc: string; };
                moment: { name: string; desc: string; };
                silence: { name: string; desc: string; };
                resetTooltip: string;
            };
            narrationWpm: { name: string; desc: string; };
            writingSchedule: {
                header: { name: string; desc: string; badgeText: string; };
            };
            draftingWpm: { name: string; desc: string; };
            dailyMinutes: { name: string; desc: string; };
            patterns: { heading: string; seconds: string; minutes: string; runtime: string; allow: string; };
            profile: {
                defaultSuffix: string; name: string; noneFallback: string;
                duplicateTooltip: string; renameTooltip: string; renameTitle: string;
                okButton: string; cancelButton: string; deleteTooltip: string;
                alreadyDefaultTooltip: string; setDefaultTooltip: string;
                desc: string;
            };
        };
        goalsSessions: {
            header: { name: string; desc: string; };
            draftingWpm: { name: string; desc: string; };
            targetMode: { name: string; desc: string; time: string; words: string; both: string; };
            dailyMinutes: { name: string; desc: string; };
            dailyWords: { name: string; desc: string; };
            weeklyGoalDays: { name: string; desc: string; };
        };
        inquiry: {
            contribution: { excluded: string; summary: string; full: string; };
            corpus: { errorEmptyMax: string; errorSketchyMin: string; errorMediumMin: string; errorSubstantiveMin: string; resetTooltip: string; name: string; desc: string; };
            prompts: { name: string; proTag: string; alreadyAddedTag: string; alreadyAdded: string; dragToReorder: string; labelPlaceholder: string; fixedTemplate: string; replaceWithTemplate: string; applyCanonical: string; resetToCanonical: string; deleteQuestion: string; questionPlaceholder: string; customizedQuestion: string; unlockProGhost: string; chooseCanonical: string; noRemainingCanonical: string; addQuestion: string; zoneFullNote: string; };
            sources: { name: string; };
            booksForInquiry: { name: string; desc: string; buttonText: string; ariaLabel: string; };
            scanRoots: { name: string; desc: string; placeholder: string; characterFolder: string; placeFolder: string; commonSupportFolders: string; tooManyFolders: string; };
            materialRules: { name: string; desc: string; };
            presets: { name: string; desc: string; default: string; light: string; deep: string; };
            classTable: { enabled: string; class: string; book: string; saga: string; reference: string; matches: string; matchCount: string; };
            bookStatus: { ready: string; missingScenesAndOutline: string; missingScenes: string; missingOutline: string; };
            booksTable: { sequence: string; book: string; detectedMaterial: string; status: string; empty: string; materialCounts: string; };
            zone: { setup: string; pressure: string; payoff: string; };
            modal: { badge: string; cancel: string; };
            canonicalLibrary: { name: string; descPro: string; descFree: string; loadFullProSet: string; loadAllTooltip: string; loadCoreQuestions: string; };
            corpusTable: { tier: string; threshold: string; };
            corpusTier: { empty: string; sketchy: string; medium: string; substantive: string; };
            config: { name: string; desc: string; };
        };
        authorProgress: {
            hero: { badgeRefresh: string; badgeDefault: string; wikiAriaLabel: string; title: string; desc: string; keyBenefitsHeading: string; featureSpoilerSafe: string; featureShareable: string; featureStageWeighted: string; };
            preview: { sizeLabel: string; actualSizePreview: string; teaserAuto: string; teaserRing: string; teaserScenes: string; teaserColor: string; teaserComplete: string; publish: string; publishTooltip: string; loading: string; lastUpdateNever: string; kickstarterReady: string; patreonFriendly: string; emptyState: string; renderError: string; lastUpdate: string; };
            configuration: { name: string; desc: string; autoUpdateExportPaths: { name: string; desc: string; }; };
            styling: {
                name: string; desc: string; choosePaletteButton: string;
                fontDefault: string; fontSystemUI: string;
                weightLight: string; weightLightItalic: string; weightNormal: string; weightNormalItalic: string; weightMedium: string; weightMediumItalic: string; weightSemiBold: string; weightSemiBoldItalic: string; weightBold: string; weightBoldItalic: string; weightExtraBold: string; weightExtraBoldItalic: string; weightBlack: string; weightBlackItalic: string;
                customFontModal: { customOption: string; title: string; hint: string; placeholder: string; cancel: string; save: string; };
                autoButton: string;
                title: { label: string; desc: string; };
                author: { label: string; desc: string; placeholder: string; };
                percentSymbol: { label: string; desc: string; };
                percentNumber: { label: string; desc: string; };
                stageBadge: { label: string; desc: string; };
                transparentMode: { name: string; desc: string; };
                backgroundColor: { name: string; desc: string; };
                spokesAndBorders: { name: string; desc: string; };
                strokeLightStrokes: string; strokeDarkStrokes: string; strokeNoStrokes: string; strokeCustomColor: string; strokeSyncBackground: string;
            };
            publishing: {
                name: string;
                updateFrequency: { name: string; desc: string; };
                frequencyManual: string; frequencyDaily: string; frequencyWeekly: string; frequencyMonthly: string;
                refreshAlertThreshold: { name: string; desc: string; };
                exportPath: { name: string; desc: string; };
                autoUpdateExportPaths: { name: string; desc: string; };
                proTeaser: { wantMore: string; enhanceWorkflow: string; desc: string; upgradeLink: string; };
            };
            progressMode: {
                name: string; desc: string; detecting: string; dateRangePlaceholder: string; dateRangeFormat: string;
                noScenesFound: string; noProgressEstimate: string; allScenesComplete: string; basedOnEstimate: string;
                errorEnterBothDates: string; errorUseDateFormat: string; errorStartBeforeTarget: string;
                zeroMode: string; dateTargetMode: string; guidanceZero: string; guidanceDate: string;
                publishStageAuto: string; guidancePublishStage: string;
                stageDetected: string;
            };
            attribution: { name: string; desc: string; };
        };
    };
    timelineRepairModal: {
        config: { noAiPill: string; title: string; subtitle: string; statTotalScenes: string; statWithWhen: string; statMissingWhen: string; previewButton: string; cancelButton: string; restoreButton: string; restoreTooltip: string; restoreEmptyTooltip: string; };
        express: { title: string; desc: string; button: string; successNotice: string; fullyDated: string; fullyDatedHint: string; openAuditButton: string; };
        anchor: { name: string; desc: string; dateLabel: string; timeLabel: string; pillAuthored: string; pillFallback: string; };
        preview: { name: string; };
        pattern: { name: string; desc: string; };
        refinements: { name: string; desc: string; baseScaffoldTitle: string; baseScaffoldDesc: string; alwaysOn: string; textCuesTitle: string; textCuesDesc: string; };
        analyzing: { badge: string; title: string; statusApplying: string; preparing: string; abortButton: string; abortedNotice: string; phasePattern: string; phaseCues: string; phaseComplete: string; };
        review: { badge: string; title: string; subtitle: string; filterNeedsReview: string; filterTextCues: string; rippleMode: string; rippleModeHelp: string; rippleAnchoredToggle: string; rippleAnchoredHelp: string; undoTooltip: string; redoTooltip: string; historyTooltip: string; historyEmpty: string; historyItem: string; snapshotAssurance: string; overwriteAuthorDates: string; overwriteAuthorDatesHelp: string; backButton: string; applyButton: string; openAuditButton: string; openAuditButtonAll: string; auditToggleOn: string; auditToggleOff: string; narrativePlacement: string; chronoPosition: string; emptyFilter: string; untitled: string; warningBackwardTime: string; warningLargeGap: string; warningMissingWhen: string; warningDuplicateWhen: string; openInWorkspace: string; shiftDayBack: string; shiftDayForward: string; shiftHourBack: string; shiftHourForward: string; summaryChanged: string; summaryNeedReview: string; summarySelected: string; summaryAuthored: string; };
        apply: { noChangesNotice: string; partialNotice: string; successWithSnapshotNotice: string; snapshotFailedNotice: string; };
        restore: { successNotice: string; partialOfTotalNotice: string; partialNotice: string; noFrontmatterNotice: string; noSnapshotNotice: string; menuItem: string; toolScaffold: string; toolAudit: string; };
        reset: { button: string; tooltip: string; title: string; body: string; note: string; confirmButton: string; successNotice: string; };
        confirm: { title: string; warning: string; applyButton: string; cancelButton: string; description: string; };
    };
    timelineAuditModal: {
        header: { badge: string; aiPill: string; title: string; subtitle: string; aiEnhancedBadge: string; focusedScope: string; focusedClear: string; };
        loading: { title: string; description: string; };
        actions: { abort: string; reRunAudit: string; applyAccepted: string; close: string; snapshotAssurance: string; };
        empty: { noResults: string; noFindings: string; };
        scope: { entireVault: string; activeScope: string; };
        stats: { totalScenes: string; aligned: string; warnings: string; contradictions: string; missingWhen: string; };
        filters: { all: string; contradictions: string; missingWhen: string; summaryBodyDisagreement: string; continuityProblems: string; aiChecked: string; aiSuggested: string; unresolved: string; };
        controls: { title: string; };
        bulk: { acceptSafe: string; keepAll: string; markAll: string; scopeNote: string; };
        instantCard: { title: string; description: string; status: string; continuityPassToggle: string; continuityPassDesc: string; };
        aiScope: { title: string; manuscript: string; range: string; marked: string; focused: string; fromScene: string; toScene: string; manuscriptSummary: string; rangeSummary: string; markedSummary: string; focusedSummary: string; evidence: string; providerLocal: string; providerConfigured: string; };
        aiCard: { title: string; aiEnhancedBadge: string; description: string; actionRunning: string; actionReRun: string; actionStart: string; };
        aiStatus: { inProgress: string; complete: string; failed: string; notStarted: string; runningBackground: string; failedRetry: string; notStartedHint: string; progressCount: string; progressCountWithScene: string; completedSummary: string; };
        relativeTime: { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string; };
        overview: { title: string; legendClean: string; legendMissingWhen: string; legendWarning: string; legendContradiction: string; legendImpossible: string; };
        detail: { whatYamlSays: string; chronologyNotPlaced: string; whatManuscriptImplies: string; noAlternatePosition: string; noSuggestedWhen: string; whyFlagged: string; whatAuthorCanDo: string; actionEligible: string; actionAiSuggestionAvailable: string; actionIneligible: string; noEvidence: string; applyButton: string; keepButton: string; markReviewButton: string; noRationale: string; whenMissing: string; formatWhenMissing: string; chronologyPosition: string; suggestedWhen: string; aiTimelineRole: string; evidenceLabel: string; whenInvalid: string; whenCurrent: string; adjustRippleButton: string; adjustRippleHelp: string; };
        evidenceSource: { summary: string; synopsis: string; body: string; neighbor: string; ai: string; };
        evidenceTier: { direct: string; strongInference: string; ambiguous: string; };
        detectionSource: { deterministic: string; continuity: string; ai: string; aiChecked: string; aiQueued: string; };
        timelineRole: { mainline: string; flashback: string; flashForward: string; parallel: string; unclear: string; };
        notices: { applySuccess: string; applyPartial: string; snapshotFailed: string; emptyAiScope: string; aiScanAlreadyRunning: string; };
    };
    timeline: {
        acts: {
            act1: string;
            act2: string;
            act3: string;
            /** Fallback label shown when no custom act label is configured. {{number}} is substituted with 1-based act index. */
            actFallback: string;
        };
        /** @deprecated Kept for structural compat; use DEFAULT_BOOK_TITLE instead. */
        workInProgress: string;
        defaultBookTitle: string;
        loading: string;
        loadingData: string;
        renderError: string;
        /** Synopsis hover label for past-due dates. {{date}} is substituted with the formatted date string. */
        overdue: string;
        search: {
            inputLabel: string;
            placeholder: string;
            searchAction: string;
            clearAction: string;
            panelLabel: string;
            scopeLegend: string;
            scopeTimelineFields: { label: string; hint: string };
            scopeBody: { label: string; hint: string };
            assistLabel: string;
            /** Shown beside the assist toggle while local-server support is not yet wired up. */
            assistUnavailable: string;
            statusIdle: string;
            statusRunning: string;
            /** {{count}} is substituted with the number of matched scenes. */
            statusMatches: string;
            statusNoMatches: string;
            statusNoScope: string;
            /** {{message}} is substituted with the verbatim failure text. */
            statusError: string;
        };
        modes: {
            narrative: { name: string; acronym: string };
            progress: { name: string; acronym: string };
            chronologue: { name: string; acronym: string };
            gossamer: { name: string; acronym: string };
        };
        subplotAlignment: {
            groupLabel: string;
            fill: { label: string; tooltip: string };
            sequence: { label: string; tooltip: string };
            /** Action half of the toggle tooltip. {{name}} is the other alignment's label. */
            switchTo: string;
        };
        subplotRing: {
            allScenes: string;
            mainPlot: string;
            chronologue: string;
        };
        grid: {
            statusHeader: {
                todo: string;
                working: string;
                completed: string;
                due: string;
            };
            stageHeader: {
                zero: string;
                author: string;
                house: string;
                press: string;
            };
        };
    };
    commands: {
        openTimeline: string;
        openInquiry: string;
        inquiryOmnibusPass: string;
        searchTimeline: string;
        createNote: string;
        manageSubplots: string;
        bookDesigner: string;
        timelineOrder: string;
        timelineAudit: string;
        manuscriptExport: string;
        planetaryTimeCalculator: string;
        gossamerScoreManager: string;
        gossamerAnalysis: string;
        authorProgressReport: string;
        exportTimelineImage: string;
        exportTimelineData: string;
    };
    common: {
        yes: string;
        no: string;
        cancel: string;
        save: string;
        reset: string;
        enable: string;
        disable: string;
        loading: string;
        error: string;
        success: string;
    };
    notices: {
        settingsSaved: string;
        invalidInput: string;
    };
    manuscriptModal: {
        badge: string;
        title: string;
        description: string;
        heroLoading: string;
        heroNarrativeMeta: string;
        exportHeading: string;
        exportTypeManuscript: string;
        exportTypeOutline: string;
        proBadge: string;
        proRequired: string;
        proEnabled: string;
        manuscriptPresetHeading: string;
        presetNovel: string;
        presetNovelDesc: string;
        presetScreenplay: string;
        presetScreenplayDesc: string;
        presetPodcast: string;
        presetPodcastDesc: string;
        outlineBeatSheetDesc: string;
        outlineEpisodeRundownDesc: string;
        outlineShootingScheduleDesc: string;
        outlineIndexCardsDesc: string;
        formatMarkdown: string;
        formatPdf: string;
        formatDocx: string;
        formatCsv: string;
        formatJson: string;
        outlinePresetHeading: string;
        outlineBeatSheet: string;
        outlineEpisodeRundown: string;
        outlineShootingSchedule: string;
        outlineIndexCardsCsv: string;
        outlineIndexCardsJson: string;
        tocHeading: string;
        tocPlain: string;
        tocMarkdown: string;
        tocNone: string;
        tocNote: string;
        orderHeading: string;
        orderNarrative: string;
        orderReverseNarrative: string;
        orderChronological: string;
        orderReverseChronological: string;
        orderNote: string;
        rangeHeading: string;
        rangeFirst: string;
        rangeLast: string;
        rangeAllLabel: string;
        rangeSingleLabel: string;
        rangeSelectedLabel: string;
        rangeCountLabel: string;
        rangeStatus: string;
        rangeLoading: string;
        rangeDecimalWarning: string;
        actionCreate: string;
        actionCancel: string;
        emptyNotice: string;
        templateNotConfigured: string;
        templateNotFound: string;
        templateFound: string;
        configureInSettings: string;
        rangeEmpty: string;
        loadError: string;
        wordCountHeading: string;
        wordCountToggle: string;
        wordCountNote: string;
        includeSynopsis: string;
        includeSynopsisNote: string;
    };
    planetary: {
        heading: string;
        enable: { name: string; desc: string; };
        active: { name: string; desc: string; disabled: string; };
        actions: { add: string; delete: string; };
        fields: {
            profileName: string;
            hoursPerDay: string;
            daysPerWeek: string;
            daysPerYear: string;
            epochOffset: string;
            epochLabel: string;
            monthNames: string;
            weekdayNames: string;
        };
        preview: {
            heading: string;
            invalid: string;
            empty: string;
            disabled: string;
        };
        modal: {
            title: string;
            activeProfile: string;
            converterDesc: string;
            directionLabel: string;
            directionDesc: string;
            earthToPlanet: string;
            planetToEarth: string;
            planetFallback: string;
            earthDatetimeLabel: string;
            earthDatetimeDesc: string;
            planetDateLabel: string;
            planetDateDesc: string;
            planetTimeLabel: string;
            planetTimeDesc: string;
            yearField: string;
            monthField: string;
            dayField: string;
            hourField: string;
            minuteField: string;
            monthFallback: string;
            todayTooltip: string;
            datetimeLabel: string;
            datetimeDesc: string;
            now: string;
            convert: string;
            noProfile: string;
            disabled: string;
            invalid: string;
            invalidPlanet: string;
        };
        synopsis: { prefix: string; };
        tooltip: { altHint: string; };
    };
    inquiry: {
        help: {
            tooltip: string;
            configTooltip: string;
            noScenesTooltip: string;
            corpusTooltip: string;
            resultsTooltip: string;
            runningTooltip: string;
            runningSingleTooltip: string;
            onboardingTooltip: string;
            noApiKeyTooltip: string;
        };
        mobile: {
            title: string;
            subtitle: string;
            openBriefs: string;
            viewLatest: string;
        };
        nav: {
            bookUnresolved: string;
            waitingForProvider: string;
            backgroundRunInProgress: string;
            welcome: string;
            previousBook: string;
            nextBook: string;
            noPreviousBook: string;
            noNextBook: string;
        };
        navTooltip: {
            scopeToggle: string;
            flowLens: string;
            depthLens: string;
            modeIconToggle: string;
            focusRingToggle: string;
            previousBook: string;
            nextBook: string;
        };
        runner: {
            contactingProvider: string;
            running: string;
            cancelRequested: string;
            finalizing: string;
            waiting: string;
            singlePassExceeded: string;
            singlePassFitFailedWithBudget: string;
            singlePassFitFailedUnknown: string;
            multiPassNotComplete: string;
            multiPassUnknownNotComplete: string;
            multiPassNotCompleteFallback: string;
            executionPrecheckFailed: string;
            multiPassFailureGeneric: string;
            runAborted: string;
            tokenEstimateUnavailable: string;
            jsonNotFound: string;
            inquiryAiUnavailable: string;
            omnibusReservedForGoogle: string;
            inquiryAlreadyRunning: string;
            inquiryNotConfigured: string;
            noScenesAvailable: string;
            noEnabledQuestions: string;
            scopeChanged: string;
            questionSetChanged: string;
            corpusContributionChanged: string;
            providerStrategyChanged: string;
            previousRunCompleted: string;
            stubResultGeneric: string;
            stubResultPreview: string;
            aiResponseRecovered: string;
            aiUnsupportedParameter: string;
            aiRequestRejected: string;
            aiAuthError: string;
            aiTimedOut: string;
            aiRateLimited: string;
            stubResultUnavailable: string;
            integrityNoVerified: string;
            integrityUnverified: string;
            unableToBuildEvidence: string;
            noEvidenceForScope: string;
            citationsCouldNotBeMatched: string;
            noSummaryProvided: string;
            multiPassTriggerReason: string;
            inquiryRunFooter: string;
        };
        notice: {
            aiDisabledInSettings: string;
            omnibusViewFailed: string;
            omnibusMobileOnly: string;
            omnibusResumeNothing: string;
            omnibusAllSkipped: string;
            omnibusUnavailable: string;
            omnibusFailed: string;
            running: string;
            runContinuesInBackground: string;
            noEnabledQuestions: string;
            logNotFound: string;
            pendingEditsBroken: string;
            briefNotFound: string;
            briefSaved: string;
            briefSaveFailed: string;
            briefFolderFailed: string;
            briefNotSaved: string;
            noBriefActive: string;
            sceneNotFound: string;
            noRunForPreview: string;
            noRunForSave: string;
            logFolderFailed: string;
            logSaveFailed: string;
            logContentFolderFailed: string;
            logContentSaveFailed: string;
            folderAccessFailed: string;
            noBriefs: string;
            fileExplorerUnavailable: string;
            revealFolderFailed: string;
            purgedNothing: string;
            purgedScenes: string;
            purgedScenesWithRearm: string;
            coreSetLoaded: string;
        };
        interaction: {
            running: string;
            fieldAlreadyUpdated: string;
            runningWaitClear: string;
            runningWaitReset: string;
            corpusOverridesAlreadyMatch: string;
            corpusOverridesReset: string;
            noCorpusAvailable: string;
            noScenesInScope: string;
            noActionItemsToPurge: string;
            noQuestionForSlot: string;
            noQuestionsForZone: string;
            emptyScenesCannotTarget: string;
            onlySceneTicksTargetable: string;
            targetScenesBookOnly: string;
            targetSceneAdded: string;
            targetSceneRemoved: string;
            noTargetScenesToClear: string;
            clearedAllTargetScenes: string;
            corpusDisabled: string;
            inquiryAlreadyRun: string;
            targetScenesBookOnlySaga: string;
            lensAlreadyActive: string;
            onlyOneSummaryLens: string;
            cannotCancelFromPreview: string;
            cancelRequested: string;
            bookScopeUnresolved: string;
            noApiKey: string;
            writebackDisabledSimulated: string;
            noActionItemsThreshold: string;
            cancelOnlySingleQuestion: string;
            pendingEditsUpdatedDefault: string;
        };
        menu: {
            forceRerun: string;
            openCitationBriefing: string;
            openCitationMarkdown: string;
            openBriefingArticle: string;
            openBriefMarkdown: string;
            openScene: string;
            openNote: string;
            cancelTargeting: string;
            optionDefaultRun: string;
            optionStandard: string;
            optionFocused: string;
            setFocus: string;
            removeFocus: string;
            addToTargetScenes: string;
            removeFromTargetScenes: string;
            corpusExclude: string;
            corpusSummary: string;
            corpusFullScene: string;
        };
        findings: {
            findings: string;
            findingsWithCount: string;
            oneTargetScene: string;
            multipleTargetScenes: string;
            noInquiryRun: string;
            runToSeeVerdicts: string;
            verdictBookScoped: string;
            selectionFocused: string;
            selectionDiscover: string;
            validationMissingTargetRoles: string;
            scopeNoteTargetBookOnly: string;
            integrityCompromised: string;
            integrityWarning: string;
            targetSection: string;
            contextSection: string;
            unverifiedSection: string;
            unverifiedWarning: string;
            empty: string;
            lens: string;
            unverifiedHeadlinePrefix: string;
            citedAs: string;
            referencesNormalized: string;
            corpusFingerprintNotAvailable: string;
            recentSessionsNotAvailable: string;
            stubInquiryHeadline: string;
            stubBulletNote: string;
            stubBulletPlaceholder: string;
            previewFooterDismiss: string;
        };
        preview: {
            footerOpenLog: string;
            hoverPreview: string;
            inquiryNotConfiguredHero: string;
            inquiryNotConfiguredHelp: string;
            noApiKeyHero: string;
            noApiKeyHelp: string;
            noScenesHero: string;
        };
        details: {
            toggle: string;
        };
        debug: {
            origin: string;
        };
        corpus: {
            disabled: string;
            legendClickKeysTitle: string;
            legendClickCycle: string;
            legendShiftClickToggle: string;
            legendRightClickMenu: string;
            legendModeTitle: string;
            legendModeFull: string;
            legendModeSummary: string;
            legendModeExclude: string;
            legendStatusTitle: string;
            legendStatusComplete: string;
            legendStatusWorking: string;
            legendStatusTodo: string;
            legendStatusOverdue: string;
            legendQuestionTitle: string;
            legendQuestionReady: string;
            legendQuestionRun: string;
            legendQuestionStale: string;
            legendQuestionProFresh: string;
            legendQuestionProRun: string;
            legendQuestionError: string;
            legendTierTitle: string;
            legendTierSubstantive: string;
            legendTierMedium: string;
            tooltipStatusOverdue: string;
            tooltipStatusComplete: string;
            tooltipStatusTodo: string;
            tooltipStatusWorking: string;
            tooltipModeExclude: string;
            tooltipTargetActive: string;
            tooltipWordsLabel: string;
            statusOverdueLabel: string;
            statusTodoLabel: string;
            statusWorkingLabel: string;
            statusCompleteLabel: string;
        };
        settingsExtra: {
            autopopulateName: string;
            autopopulateDesc: string;
            replaceQuestionsTitle: string;
            replaceCustomizedQuestionsTitle: string;
            replaceQuestionsConfirm: string;
            replaceCustomTitle: string;
            replaceCustomSubtitle: string;
            replaceCustomWarningOne: string;
            replaceCustomWarningMany: string;
            replaceCustomConfirm: string;
            replaceCanonicalTitle: string;
            replaceCanonicalSubtitle: string;
            loadCanonicalSubtitleCustomized: string;
            loadCanonicalSubtitleCurrent: string;
            coreQuestionsLabel: string;
            fullProSetLabel: string;
            collapse: string;
            expand: string;
        };
    };
    bookDesigner: {
        saveTemplate: {
            badge: string;
            title: string;
            subtitle: string;
            nameField: {
                name: string;
                desc: string;
                placeholder: string;
            };
            note: string;
            nameRequired: string;
        };
        deleteTemplate: {
            title: string;
            subtitle: string;
        };
        demoProject: {
            badge: string;
            title: string;
            subtitle: string;
            startDate: {
                name: string;
                desc: string;
            };
            note: string;
            generate: string;
            invalidDate: string;
        };
        modal: {
            badge: string;
            title: string;
            subtitle: string;
            wikiAriaLabel: string;
            noBookSelected: string;
            untitled: string;
        };
        meta: {
            autoMode: string;
            manualMode: string;
            manualLayoutActive: string;
            autoDistribution: string;
            fromTemplate: string;
        };
        sections: {
            locationStructure: string;
            contentConfiguration: string;
            sceneSetsExtras: string;
        };
        fields: {
            targetBook: {
                name: string;
                desc: string;
                noBooks: string;
                addFirstNote: string;
            };
            timeIncrement: {
                name: string;
                desc: string;
                placeholder: string;
                invalid: string;
            };
            scenes: {
                name: string;
                desc: string;
            };
            targetLength: {
                name: string;
                desc: string;
                detail: string;
            };
            acts: {
                label: string;
                actLabel: string;
            };
            subplots: {
                name: string;
                desc: string;
            };
            characters: {
                name: string;
                desc: string;
            };
            sceneSet: {
                label: string;
                base: string;
                advanced: string;
            };
            generateBeats: {
                withSystem: string;
                noSystem: string;
                tooltipNoSystem: string;
                existsAria: string;
                noSystemAria: string;
                yes: string;
                no: string;
            };
            sceneLayouts: {
                name: string;
                desc: string;
                newOption: string;
                emptyOption: string;
            };
        };
        preview: {
            title: string;
            dragging: string;
            subplotFallback: string;
        };
        buttons: {
            saveSceneSet: string;
            reset: string;
            demoProject: string;
            deleteLayout: string;
            createBook: string;
            save: string;
            delete: string;
            cancel: string;
        };
        notes: {
            layoutTemplatesIncludes: string;
        };
        notices: {
            layoutReset: string;
            templateDeleted: string;
            templateNotFound: string;
            templateSaved: string;
            templateUpdated: string;
            templateApplied: string;
            selectBookForDemo: string;
            selectBookForGenerate: string;
            folderError: string;
            baseSetMissing: string;
            generating: string;
            beatsExist: string;
            noBeatSystemActive: string;
            beatsError: string;
            bookCreated: string;
            bookCreatedSkipped: string;
            bookCreatedBeatsExist: string;
            bookCreatedBeats: string;
            demoReady: string;
            demoSkipped: string;
        };
    };
    gossamer: {
        scoreModal: {
            badgePrefix: string;
            beatSystemTitle: string;
            subtitle: string;
            signalMeta: string;
            beatsDetectedMeta: string;
            noActiveBeatSystem: string;
            noBeatsCustom: string;
            noBeatsForModel: string;
            countMismatch: string;
            enterScoreLabel: string;
            scorePlaceholder: string;
            scoreCount: string;
            groupMaintenance: string;
            groupAi: string;
            normalizeButton: string;
            deleteButton: string;
            deleteAllButton: string;
            copyButton: string;
            pasteButton: string;
            saveButton: string;
            cancelButton: string;
            aiMetaPrefix: string;
            aiMetaVaultLink: string;
            aiMetaSuffix: string;
            tooltipNormalizeAvailable: string;
            tooltipNormalizeNone: string;
            tooltipCopy: string;
            tooltipPaste: string;
            tooltipSave: string;
            tooltipCancel: string;
            normalizeConfirmMessage: string;
            normalizedDone: string;
            normalizeArchive: string;
            normalizeNothing: string;
            normalizeNoFragments: string;
            exportFolderMissing: string;
            openExplorerSidebar: string;
            explorerNoReveal: string;
            pastePartial: string;
            pasteSuccess: string;
            pasteError: string;
            noBookSystem: string;
            noBeatsAvailable: string;
            noScenesInBook: string;
            manuscriptEmpty: string;
            promptCopied: string;
            promptCopyFailed: string;
            clipboardReadFailed: string;
            clipboardEmpty: string;
            noScoresDetected: string;
            invalidScore: string;
            errorsList: string;
            noChanges: string;
            updatedCount: string;
            saveFailed: string;
            archivedDeletion: string;
            noScoresToDelete: string;
            deletedScores: string;
            deleteFailed: string;
            missingMetadata: string;
            deleteConfirmBadge: string;
            deleteConfirmTitle: string;
            deleteConfirmSubtitle: string;
            deleteConfirmBody: string;
            deleteConfirmButton: string;
            deleteConfirmCancel: string;
            noGossamerToDelete: string;
            deletedAllGossamer: string;
            deleteAllConfirmTitle: string;
            deleteAllConfirmSubtitle: string;
            deleteAllConfirmBody: string;
            deleteAllConfirmButton: string;
            normalizeConfirmBadge: string;
            normalizeConfirmTitle: string;
            normalizeConfirmSubtitle: string;
            normalizeIssuesTitle: string;
            normalizeGapLabel: string;
            normalizeGapsLabel: string;
            normalizeOutOfOrder: string;
            normalizeOrphanLabel: string;
            normalizeOrphansLabel: string;
            normalizeWillCompact: string;
            normalizeMoreSuffix: string;
            normalizeConfirmButton: string;
            normalizeConfirmCancel: string;
        };
        processingModal: {
            statusInitializing: string;
            badge: string;
            title: string;
            backgroundContinues: string;
            modelDisabled: string;
            confirmSubtitle: string;
            gatheringDetails: string;
            manuscriptInfoHeading: string;
            keyMissing: string;
            beginButton: string;
            cancelButton: string;
            analyzingManuscript: string;
            assemblingManuscript: string;
            statusHeading: string;
            waitingToSend: string;
            advancedHeading: string;
            closeButton: string;
            waitingFirstRequest: string;
            statScenes: string;
            statWords: string;
            statCorpusTokens: string;
            statBeats: string;
            statEvidence: string;
            evidenceDefault: string;
            beatSystemLine: string;
            timerElapsed: string;
            timerLongerThanExpected: string;
            timerEstimate: string;
            timerTypical: string;
            apiFailed: string;
            errorsHeader: string;
            errorLogLinkLabel: string;
            analysisComplete: string;
            analysisFailed: string;
            rateLimitWithRetry: string;
            rateLimit: string;
            rateLimited: string;
            advRoleTemplate: string;
            advResolvedModel: string;
            advModelSelectionReason: string;
            advAvailabilityVisible: string;
            advAvailabilityNotVisible: string;
            advAvailabilityUnknown: string;
            advAvailability: string;
            advAppliedCaps: string;
            advTokenEstimate: string;
            advTokenEstimateUnavailable: string;
            advPackaging: string;
            advEvidence: string;
            advFinalPromptLabel: string;
            advFinalPromptNone: string;
            advPassCount: string;
            advMultiPassTrigger: string;
        };
        notices: {
            noStoryBeats: string;
            cannotEnterMode: string;
            systemHintWithModel: string;
            systemHintNoModel: string;
            modeMatchHintWithModel: string;
            modeMatchHintNoModel: string;
            noScoresInfo: string;
            modeToggleSwitchMain: string;
            modeToggleSwitchAll: string;
            noActiveBeatSystemRun: string;
            validating: string;
            loadingBeats: string;
            assemblingEvidence: string;
            assemblingEvidenceWithMode: string;
            noScenesInBook: string;
            noSceneBodyContent: string;
            buildingPrompt: string;
            sendingToAi: string;
            aiResponseError: string;
            updatingBeats: string;
            archivedSnapshot: string;
            generatingLog: string;
            successUpdated: string;
            successLogWithContent: string;
            successLogWithoutContent: string;
            processingFailed: string;
            aiAnalysisFailed: string;
            prepareFailed: string;
            retryGemini: string;
            unmatchedBeats: string;
            validationFailed: string;
        };
        service: {
            updatedBeatScoresPlural: string;
            updatedBeatScoreSingular: string;
            archivedSingleSnapshot: string;
            noBeatsUpdated: string;
            updatedBeatScores: string;
            archivedWithPath: string;
        };
    };
    sceneAnalysis: {
        confirm: {
            badge: string;
            title: string;
            continueButton: string;
            cancelButton: string;
        };
        processingModal: {
            titleSummaryRefresh: string;
            titleScenePulse: string;
            titleProcessingSubplot: string;
            titleProcessingEntireSubplot: string;
            badgeAiSummary: string;
            badgeAiPulseRun: string;
            subtitleSynopsis: string;
            subtitleEntireSubplot: string;
            subtitleFlaggedSubplot: string;
            modeUnprocessed: string;
            modeForceAll: string;
            modeFlagged: string;
            modeSynopsisFlagged: string;
            modeSynopsisMissingWeak: string;
            modeSynopsisMissing: string;
            modeSynopsisAll: string;
            modeOptions: {
                synopsisFlaggedTitle: string;
                synopsisFlaggedDesc: string;
                synopsisMissingTitle: string;
                synopsisMissingDesc: string;
                synopsisMissingWeakTitle: string;
                synopsisMissingWeakDesc: string;
                synopsisAllTitle: string;
                synopsisAllDesc: string;
                openTitle: string;
                openDesc: string;
                flaggedTitle: string;
                flaggedDesc: string;
                unprocessedTitle: string;
                unprocessedDesc: string;
                forceAllTitle: string;
                forceAllDesc: string;
            };
            controls: {
                targetLengthLabel: string;
                targetLengthHelp: string;
                weakThresholdLabel: string;
                weakThresholdHelp: string;
                alsoUpdateSynopsis: string;
                alsoUpdateSynopsisHelp: string;
                synopsisLengthInvalid: string;
                thresholdWarning: string;
            };
            count: {
                calculating: string;
                scenesToProcessLabel: string;
                estimatedTimeLabel: string;
                estimatedTimeValue: string;
                largeBatchWarning: string;
                errorCalculating: string;
            };
            buttons: {
                start: string;
                purge: string;
                cancel: string;
                abort: string;
                close: string;
                applyChanges: string;
                discard: string;
                resume: string;
            };
            confirmLargeBatch: string;
            queue: {
                title: string;
                empty: string;
                noteSynopsis: string;
                notePulse: string;
                previousLabel: string;
                currentLabel: string;
                nextLabel: string;
                startOfBoundary: string;
                endOfBoundary: string;
                boundaryManuscript: string;
                boundarySubplot: string;
                unnumberedScene: string;
            };
            progress: {
                initializing: string;
                initializingPipeline: string;
                sceneProgress: string;
                processingScene: string;
                processingSceneEstimate: string;
                progressSummary: string;
                progressSummarySingle: string;
                progressSummaryPlural: string;
                failedCount: string;
                skippedCount: string;
            };
            apply: {
                review: string;
                messageSummary: string;
                messageSummaryAndSynopsis: string;
                applyingUpdates: string;
                applyingUpdatesSynopsis: string;
                successUpdated: string;
                applyError: string;
                artifactSummary: string;
                artifactSummaryAndSynopsis: string;
            };
            completion: {
                aborted: string;
                successMessage: string;
                partialMessage: string;
                failedMessage: string;
                stoppedDueToError: string;
                fatalError: string;
                processingDetailsHeading: string;
                errorsCount: string;
                warningsCount: string;
                possibleFix: string;
                logsSaved: string;
                logsNoRequest: string;
                issuesContinue: string;
                issuesAfter: string;
            };
            abort: {
                confirmMessage: string;
                aborting: string;
                stoppedDueToError: string;
                noticeAbortedByUser: string;
            };
            errorHints: {
                temperatureDefault: string;
                modelNotFound: string;
                ollamaNotResponding: string;
                connectionRefused: string;
                schemaJson: string;
                contextTooLong: string;
            };
            aiAdvanced: {
                summary: string;
                waiting: string;
                roleTemplate: string;
                resolvedModel: string;
                modelSelectionReason: string;
                availabilityVisible: string;
                availabilityNotVisible: string;
                availabilityUnknown: string;
                availabilityLabel: string;
                appliedCaps: string;
                estimatedInput: string;
                packagingAuto: string;
                finalPrompt: string;
                none: string;
                passCount: string;
                multiPassTrigger: string;
            };
            synopsisPreview: {
                previousLabel: string;
                noSummary: string;
                generating: string;
            };
            unknownError: string;
            warningEncountered: string;
            backgroundProcessing: string;
            noScenesSelected: string;
            errorPrefix: string;
        };
        runtimeModal: {
            badgePro: string;
            badgeAudiobook: string;
            badgeScreenplay: string;
            badgeRuntime: string;
            badgeRuntimeEstimator: string;
            title: string;
            titleProgress: string;
            subtitle: string;
            sections: {
                scope: string;
                scopeDesc: string;
                statusFilter: string;
                statusFilterDesc: string;
                override: string;
                overrideDesc: string;
                settings: string;
                mode: string;
                summary: string;
            };
            statusFilter: {
                todo: string;
                working: string;
                complete: string;
            };
            scope: {
                current: string;
                subplot: string;
                all: string;
                subplotLabel: string;
                sceneLabel: string;
                noSceneOpen: string;
            };
            override: {
                recalculate: string;
                recalculateHint: string;
            };
            settings: {
                accordionTitle: string;
                accordionHint: string;
                profileLabel: string;
                dialogueRateLabel: string;
                actionRateLabel: string;
                narrationRateLabel: string;
                wpmValue: string;
                parentheticalTimingsHeader: string;
                timingBeat: string;
                timingPause: string;
                timingLongPause: string;
                timingMoment: string;
                timingSilence: string;
                secondsValue: string;
                configHint: string;
            };
            modes: {
                local: string;
                ai: string;
                localDesc: string;
                aiDesc: string;
            };
            provider: {
                aiDisabled: string;
                providerLabel: string;
                providerLabelLocal: string;
            };
            count: {
                calculating: string;
                scenesToProcessLabel: string;
                hintCurrent: string;
                hintNoStatus: string;
                hintAlreadyRuntime: string;
                errorPrefix: string;
            };
            buttons: {
                settingsTooltip: string;
                estimate: string;
                cancel: string;
                abort: string;
                close: string;
            };
            progress: {
                initializing: string;
                initialProgress: string;
                runningTotalLabel: string;
                runningTotalDefault: string;
                sceneProgress: string;
                processingScene: string;
                scenesProcessed: string;
            };
            completion: {
                successMessage: string;
                aborted: string;
                errorPrefix: string;
                aiEstimateReady: string;
                aiErrorPrefix: string;
                localAiCompare: string;
            };
            aiAdvanced: {
                summary: string;
                waiting: string;
                roleTemplate: string;
                resolvedModel: string;
                modelSelectionReason: string;
                availabilityVisible: string;
                availabilityNotVisible: string;
                availabilityUnknown: string;
                availabilityLabel: string;
                appliedCaps: string;
                packagingAuto: string;
                finalPrompt: string;
                none: string;
                passCount: string;
                multiPassTrigger: string;
            };
            notices: {
                background: string;
                aborting: string;
                aiAnalyzing: string;
            };
        };
        pipeline: {
            notices: {
                processingSubplotInit: string;
                analyzingSubplot: string;
                sceneStatusSkip: string;
                processingScene: string;
                progressUpdate: string;
                subplotComplete: string;
                subplotErrorGeneric: string;
                noSubplotScenes: string;
                noScenesValid: string;
                noFlaggedSubplotScenes: string;
                noScenesForSubplot: string;
                noScenesContentSubplot: string;
                noRemainingResumingSubplot: string;
                noFlaggedPulseUpdateSubplot: string;
                abortedByUser: string;
                abortedRateLimit: string;
                fatalError: string;
            };
            errors: {
                failedUpdate: string;
                aiProcessingFailed: string;
                fatalScene: string;
                localLlmReview: string;
            };
        };
        maintenance: {
            yamlTest: {
                starting: string;
                errorTfile: string;
                errorMissingFm: string;
                errorParse: string;
                success: string;
                failed: string;
                errorGeneric: string;
            };
            purge: {
                badgeWarning: string;
                title: string;
                subtitle: string;
                dangerHeader: string;
                areYouSure: string;
                buttonPurge: string;
                buttonCancel: string;
                noScenes: string;
                confirmManuscript: string;
                confirmSubplot: string;
                detailFields: string;
                detailPulseUpdate: string;
                detailPulseLastUpdated: string;
                noticeStart: string;
                noticeStartSubplot: string;
                resultManuscript: string;
                resultSubplot: string;
                archived: string;
                errorGeneric: string;
            };
            saveError: string;
        };
        synopsis: {
            notices: {
                reopeningSession: string;
                noScenesScope: string;
                scopeMessage: string;
                noMatchingScenes: string;
                sceneFileNotFound: string;
            };
            aiErrors: {
                aiError: string;
                jsonParseError: string;
                emptyResult: string;
                synopsisFailed: string;
                saveError: string;
                summaryFailed: string;
                contextTooLongWithSize: string;
                contextTooLongNoSize: string;
                unknownPassFailure: string;
            };
        };
        service: {
            commands: {
                summaryRefresh: string;
                scenePulseManuscript: string;
                scenePulseSubplot: string;
                runtimeEstimator: string;
            };
            notices: {
                noSubplots: string;
                aiDisabled: string;
                localLlmDisabled: string;
                localLlmRequiresUrl: string;
                providerKeyMissing: string;
            };
            subplotPicker: {
                title: string;
                subtitle: string;
                badge: string;
                badgeWith: string;
                flaggedScenes: string;
                processableScenes: string;
                totalScenes: string;
                pickLabel: string;
                processFlagged: string;
                processEntire: string;
                purgeAll: string;
                cancel: string;
                stats: string;
                infoLocalLlm: string;
                infoCloud: string;
                infoLine: string;
                noOptions: string;
                unknownSelection: string;
            };
            errorPrefix: string;
            aiDisabledLabel: string;
        };
        aiProvider: {
            callError: string;
            genericError: string;
        };
        commands: {
            runtimeEstimator: string;
        };
        runtime: {
            notices: {
                noScenesToProcess: string;
                aiAnalyzing: string;
                completeWithErrors: string;
                completeSuccess: string;
            };
        };
    };
}

// ═══════════════════════════════════════════════════════════════════
// ENGLISH TRANSLATIONS
// ═══════════════════════════════════════════════════════════════════
export const en: TranslationKeys = {
    settings: {
        general: {
            sourcePath: {
                name: 'Legacy: source path (deprecated)',
                desc: 'This legacy field is no longer the main setup path. Configure book folders in Core → Books.',
                placeholder: 'Example: Manuscript/Scenes',
            },
            /** @deprecated Legacy toggle — book title is now set via Book Profiles. */
            showTitle: {
                name: 'Legacy: source path title (deprecated)',
                desc: 'This setting is no longer used. Book title is managed via Core → Books.',
            },
        },
        pov: {
            heading: 'Point of view',
            vaultDefault: {
                name: 'Global POV',
                desc: 'Choose a default mode to apply. Scene level POV will override this global setting.',
            },
            yamlOverrides: {
                name: 'Scene override examples',
                desc: 'In scene frontmatter, you can use `POV:` first, second, third, omni, objective, or a number such as two, four, count, or all to designate more than one character is carrying the scene POV. Count values mark the first N names in `Character:` and use the Global POV mode to choose the marker.',
            },
            modes: {
                off: 'Legacy (first listed character, POV)',
                first: 'First-person voice (¹)',
                second: 'Second-person voice (You²)',
                third: 'Third-person limited (³)',
                omni: 'Omni narrator (Omni³)',
                objective: 'Objective — camera-eye narrator (Narrator°)',
            },
            preview: {
                heading: 'POV EXAMPLES',
                examples: {
                    sceneFirst: 'Scene YAML: POV: first | Character: [Alice]',
                    sceneThird: 'Scene YAML: POV: third | Character: [Bob]',
                    sceneSecond: 'Scene YAML: POV: second | Character: [Alice, Bob]',
                    sceneOmni: 'Scene YAML: POV: omni | Character: [Alice, Bob]',
                    sceneObjective: 'Scene YAML: POV: objective | Character: [Alice, Bob]',
                    countTwoThird: 'Global setting: POV = third | Scene YAML: POV: two | Character: [Alice, Bob]',
                    countThreeThird: 'Global setting: POV = third | Scene YAML: POV: three | Character: [Alice, Bob, Charlie]',
                    countFourThird: 'Global setting: POV = third | Scene YAML: POV: four | Character: [Alice, Bob, Charlie, Diana]',
                    countTwoFirstNumeric: 'Global setting: POV = first | Scene YAML: POV: 2 | Character: [Alice, Bob]',
                    countAllFirst: 'Global setting: POV = first | Scene YAML: POV: all | Character: [Alice, Bob, Charlie]',
                },
            },
        },
        configuration: {
            heading: 'Configuration',
            aiOutputFolder: {
                name: 'Logs',
                desc: 'Runtime logs, archives, snapshots, and move history.',
            },
            manuscriptOutputFolder: {
                name: 'Export folder',
                desc: 'Destination for manuscript, outline, and cue card exports (Markdown, PDF, beat sheets, index cards). Must be a folder inside your vault.',
            },
            synopsisMaxLines: {
                name: 'Synopsis max words',
                desc: 'Maximum words for generated Synopsis. Hover display is synced automatically from this value.',
                placeholder: '30',
                error: 'Please enter a valid number between 10 and 300.',
            },
            rippleRename: {
                name: 'Manuscript ripple rename: normalize numeric prefixes after drag reorder.',
                desc: 'Renames scene and active-beat filenames only. Scenes stay integer (1, 2, 3). Beats become decimal minors (1.01, 1.02).',
            },
            autoExpand: {
                name: 'Auto-expand clipped scene titles',
                desc: 'When hovering over a scene, automatically expand it if the title text is clipped. Disable this if you prefer to quickly slide through scenes and read titles from the synopsis instead.',
            },
            chapterMarkers: {
                name: 'Show part and chapter markers',
                desc: 'Display part and chapter boundaries as small badges on the Narrative all-scenes ring. A scene that opens both shows a combined marker.',
            },
            readability: {
                name: 'Readability size',
                desc: 'Choose a curated font sizing profile for select timeline text. Large may be helpful for low-res screens; Normal is recommended for standard and high-dpi displays.',
                normal: 'Normal',
                large: 'Large',
            },
            showEstimate: {
                name: 'Show estimated completion date',
                desc: 'Display a tick mark and label on the timeline for the estimated completion date. Tip: When you complete a scene, set Status to Complete and Due to the completion date to improve the estimate. The timeline right-click Complete action does this automatically.',
            },
            debounce: {
                name: 'Metadata refresh debounce (ms)',
                desc: 'Delay before refreshing the timeline after YAML frontmatter changes. Increase if your vault is large and updates feel too frequent.',
                placeholder: 'e.g., 10000',
                error: 'Please enter a non-negative number.',
            },
        },
        ai: {
            heading: 'AI LLM configuration',
            enable: {
                name: 'Enable AI LLM features',
                desc: 'Show command palette options and UI scene analysis colors and hover synopsis. When off, these visuals are hidden, but metadata remains unchanged.',
            },
            hero: {
                badgeText: 'AI',
                wikiAriaLabel: 'Read more in the Wiki',
                toggleInactive: 'Inactive',
                toggleActive: 'Active',
                toggleAriaLabel: 'Enable AI features',
                titleActive: 'Editorial AI for your manuscript.',
                titleInactive: 'AI is currently paused.',
                descriptionActive: 'Evaluate structure, momentum, and continuity across your manuscript. Choose a provider, review pricing, and run Inquiry when you\u2019re ready.',
                highlightsKicker: 'AI HIGHLIGHTS',
                featureInquiry: 'Inquiry \u2014 Ask cross-scene questions and receive structured editorial feedback.',
                featurePulse: 'Pulse \u2014 Examine scenes in context using Radial Timeline\u2019s three-scene lens.',
                featureGossamer: 'Gossamer \u2014 Measure beat-level tension and narrative drive.',
                featureForceMultiplier: 'Force multiplier \u2014 Expand analytical reach with contextual, actionable insight.',
            },
            heroOff: {
                descriptionPrimary: 'Radial Timeline continues to support structure, sequencing, and story architecture without AI analysis.',
                descriptionSecondary: 'Enable AI at any time to add a layer of structured editorial insight.',
                toolsKicker: 'AVAILABLE WHEN ENABLED',
                featureInquiry: 'Inquiry \u2014 Cross-scene structural analysis.',
                featurePulse: 'Pulse \u2014 Context-aware scene evaluation.',
                featureGossamer: 'Gossamer \u2014 Beat-level narrative momentum.',
                featureEnhanced: 'Scene summaries, runtime estimates, and workflow tools.',
                muted: 'Your voice leads. AI supports.',
            },
            strategy: {
                title: 'AI Strategy',
                desc: 'Choose which AI provider and model to use for Inquiry runs.',
            },
            costEstimate: {
                title: 'Cost Estimate',
                desc: 'Estimated pricing for your current manuscript scope.',
                corpusCalculating: 'Inquiry Corpus: Calculating...',
                corpusScanning: 'Scanning corpus...',
            },
            provider: {
                name: 'Provider',
                desc: 'The AI provider used for Inquiry and other AI features.',
                optionAnthropic: 'Anthropic',
                optionOpenai: 'OpenAI',
                optionGoogle: 'Google',
                optionLocalLlm: 'Local LLM',
            },
            modelOverride: {
                name: 'Model',
                desc: 'Auto uses the latest stable model. Select a specific model to pin it.',
            },
            accessTier: {
                name: 'Access',
                desc: 'Set your provider access tier. Higher tiers unlock more context headroom.',
                tier1: 'Tier 1',
                tier2: 'Tier 2',
                tier3: 'Tier 3',
                tier4: 'Tier 4',
            },
            largeHandling: {
                name: 'What gets sent to the AI',
            },
            roleContext: {
                title: 'Role context',
                desc: 'Role and context framing applied to all AI features.',
            },
            apiKeys: {
                name: 'API keys',
            },
            configuration: {
                name: 'Configuration',
            },
            contextTemplate: {
                name: 'AI prompt role & context template',
                tooltip: 'Manage context templates for AI prompt generation and Gossamer score generation',
            },
            preview: {
                kicker: 'PREVIEW',
                resolving: 'Resolving...',
                providerPlaceholder: 'Provider: \u2014',
            },
            secureKey: {
                unavailableName: 'Secure key saving unavailable',
                unavailableDesc: 'Secure key saving is unavailable in this Obsidian build. Provider API keys cannot be configured until secret storage is available.',
                migrateName: 'Secure my saved keys',
                migrateDesc: 'Moves older provider key fields into private saved keys and clears plaintext values.',
                migrateButton: 'Secure now',
                noLegacyKeysNotice: 'No legacy provider keys were available to migrate.',
            },
            credential: {
                statusReady: 'Status: Ready \u2713',
                statusRejected: 'Status: Key rejected',
                statusNetworkBlocked: 'Status: Provider validation failed',
                statusChecking: 'Status: Checking key...',
                statusNotConfigured: 'Status: Not configured',
                helperNotConfigured: 'Paste a key to enable this provider.',
                helperRejected: 'Paste a new key to replace the saved one.',
                helperNetworkBlocked: 'Provider could not be reached. You can still replace the key below.',
                helperChecking: 'Validating saved key with the provider...',
                replaceKeyButton: 'Replace key...',
                copyKeyNameButton: 'Copy key name',
                keyNameCopiedNotice: 'Saved key name copied.',
                keyNameCopyFailNotice: 'Unable to copy saved key name.',
                placeholderAnthropic: 'Enter your Anthropic API key',
                placeholderGoogle: 'Enter your Google API key',
                placeholderOpenai: 'Enter your OpenAI API key',
            },
            localLlm: {
                configTitle: 'Local LLM Configuration',
                configDesc: 'Override the auto-detected Local LLM setup only when the standard path fails or you need a deliberate custom transport.',
                statusTitle: 'Local LLM Status / Validation',
                statusDesc: 'Auto-configuration diagnostics for the current Local LLM setup. This stays visible so you can confirm connection, validation, and capability.',
                serverName: 'Local server',
                serverDesc: 'Choose between detected local runtimes when more than one healthy server is available.',
                modelsLoading: 'Checking the local server and loading available models...',
                noModelsAuto: 'No local models are loaded yet. This list will appear when a healthy local server responds.',
                noModelsCustom: 'No local models are loaded yet. Use the actions below to check the selected local server.',
                legendNotUsable: 'Not usable',
                legendLimited: 'Limited',
                legendStrong: 'Strong',
                legendInquiryEligible: 'Inquiry eligible',
                modelActive: 'Active',
                actionsName: 'Local setup actions',
                actionsDesc: 'Use these actions when Local server detection, model loading, or validation needs another pass.',
                loadServersButton: 'Load Servers',
                loadModelsButton: 'Load Models',
                validateButton: 'Validate Local LLM',
                loadModelsTooltip: 'Load models from the selected local server',
            },
            localLlmConfig: {
                serverName: 'Local server',
                serverDesc: 'Choose the local server/runtime behind the Local LLM path. Server-specific transport stays below this seam.',
                optionOllama: 'Ollama',
                optionLmStudio: 'LM Studio',
                optionOpenaiCompat: 'OpenAI-Compatible',
                baseUrlName: 'Base URL',
                baseUrlDesc: 'The API endpoint for the selected Local server. For example: Ollama "http://localhost:11434/v1" or LM Studio "http://localhost:1234/v1".',
                manualModelName: 'Manual model ID (fallback)',
                manualModelDesc: 'Only use this if automatic model discovery cannot find the model you want. The AI Strategy model dropdown above is now the primary local model selector.',
                jsonModeName: 'Structured JSON mode',
                jsonModeDesc: 'How structured JSON output is requested from the local server. "Response format" works with Ollama, LM Studio, and most OpenAI-compatible servers. Switch to "Prompt only" only if your server rejects response_format requests.',
                optionJsonModeResponseFormat: 'Response format (recommended)',
                optionJsonModePromptOnly: 'Prompt only (compatibility fallback)',
                capabilitiesTitle: 'Model capabilities',
                capabilitiesDesc: 'Local servers do not report what their models can do, so Radial Timeline assumes strict JSON output and nothing more. Declare what your model actually handles — features that need more than you declare will refuse to run locally rather than return unreliable results.',
                capabilityReasoningStrongName: 'Extended reasoning',
                capabilityReasoningStrongDesc: 'The model holds a multi-step chain of thought and reaches a judgement, rather than pattern-matching a short answer. Required by Summary refresh, Pulse analysis, Runtime estimates, and Timeline audit. Reasoning-tuned models in the 20B+ range typically qualify; small instruct models do not.',
                capabilityLongContextName: 'Long context',
                capabilityLongContextDesc: 'The model keeps a manuscript-sized prompt coherent across its full context window, not just accepting it without truncating. Required by Gossamer.',
                capabilityHighOutputCapName: 'High output ceiling',
                capabilityHighOutputCapDesc: 'The model can emit long structured responses without truncating mid-object. Required by Gossamer.',
            },
            config: {
                inquiryTitle: 'Inquiry',
                citationsName: 'Enable citations (temporarily unavailable)',
                citationsDesc: 'Provider-level inline citations are temporarily disabled across all providers — they are structurally incompatible with strict-JSON output (Anthropic, OpenAI, Gemini). Findings still surface a verbatim quote per scene via the per-finding evidence_quote field, which appears in the Sources block.',
                timelineDisplayTitle: 'Timeline Display',
                pulseContextName: 'Pulse context',
                pulseContextDesc: 'Include previous and next scenes in triplet analysis hover reveal. (Does not affect the underlying scene properties.)',
                synopsisMaxWordsName: 'Synopsis max words',
                synopsisMaxWordsDesc: 'Base cap for generated Synopsis text. Hover can use a little more when space allows, but this remains the stored Synopsis target.',
                synopsisMaxWordsInvalid: 'Synopsis length must be between 10 and 300 words.',
                summaryRefreshTitle: 'Summary Refresh Defaults',
                targetSummaryName: 'Target summary length',
                targetSummaryDesc: 'Default word count used when opening Summary refresh. You can still change it per run.',
                targetSummaryInvalid: 'Target summary length must be between 75 and 500 words.',
                weakThresholdName: 'Treat summary as weak if under',
                weakThresholdDesc: 'Default threshold used to decide which scenes are selected for Summary refresh.',
                weakThresholdInvalid: 'Weak summary threshold must be between 10 and 300 words.',
                alsoUpdateSynopsisName: 'Also update Synopsis',
                alsoUpdateSynopsisDesc: 'When enabled, Summary refresh also writes Synopsis using the configured Synopsis max words.',
            },
        },
        progress: {
            heading: 'Progress and status',
            completionEstimate: {
                heading: 'Completion Estimate \u2022 {{stage}} Stage',
                scenesComplete: 'Scenes Complete',
                remaining: 'Remaining',
                perWeek: 'Per Week',
                completedFraction: '{{completed}}/{{total}}',
                estimatedCompletion: 'Estimated Completion:',
                daysFromNow: '({{days}} days from now)',
                insufficientData: 'Insufficient data to calculate',
                projectionHeading: 'Monthly Progress Projection',
                projectionHeadingLastPace: 'Monthly Progress Projection (based on last known pace)',
                lastProgress: 'Last progress: {{date}} ({{days}} days ago) \u2022 {{window}}-day rolling window',
            },
        },
        chronologue: {
            heading: 'Chronologue Mode',
        },
        storyBeats: {
            heading: 'Story Beats & Gossamer',
        },
        colors: {
            heading: 'Colors',
        },
        beats: {
            acts: { name: 'Acts' },
            actCount: {
                name: 'Act count',
                desc: 'Applies to Narrative, Progress, and Gossamer modes. Scene and Beat properties. (Minimum 3)',
                placeholder: '3',
            },
            actLabels: {
                name: 'Act labels (optional)',
                desc: 'Comma-separated labels. Leave blank for Act 1, Act 2, Act 3. Examples: "1, 2, 3, 4" or "Spring, Summer, Fall, Winter".',
                placeholder: 'Act 1, Act 2, Act 3',
            },
            storyBeatsSystem: { name: 'Story beats system' },
            systemEditModal: {
                badge: 'Edit',
                title: 'Edit custom system details',
                subtitle: 'This name identifies your beat system and appears in each beat note\'s frontmatter.',
                nameLabel: 'System name',
                namePlaceholder: 'Custom beats',
                descLabel: 'Description (optional)',
                descPlaceholder: 'Describe the purpose of this beat system...',
                nameRequiredNotice: 'Please enter a system name with letters or numbers.',
                nameLettersNotice: 'System name must include letters or numbers.',
                saveText: 'Save',
                cancelText: 'Cancel',
            },
            design: {
                builtInTag: 'Built-in set',
                starterTag: 'Starter set',
                savedTag: 'Saved set',
                builtInTagTooltip: 'Save a copy to turn this into a saved set.',
                starterTagTooltip: 'Save a copy to edit.',
                savedTagTooltip: 'Last saved version is current.',
                builtInDirtyTooltip: 'Built-in set has been changed. Save a copy to keep your version.',
                starterDirtyTooltip: 'Starter set has been changed. Save a copy to keep your version.',
                savedDirtyTooltip: 'Changes have been made since last save.',
                modifiedLabel: 'Modified',
                guidance: 'Create beats from the row at the bottom: enter a beat name, optional range, choose an act, then click + (or press Enter). Drag beats to reorder or drop them into another act. Use Beat notes below to create or repair beat files in your vault.',
                beatNamesNotice: 'Beat names must include letters or numbers.',
                beatNameNotice: 'Beat name must include letters or numbers.',
                beatNamePlaceholder: 'Beat name',
                newBeatPlaceholder: 'New beat',
                addBeatAriaLabel: 'Add beat',
                dragTooltip: 'Drag to reorder beat',
                rangeTooltip: 'Gossamer momentum range (e.g. 10-20)',
                setSavedNotice: 'Set saved. You can run the audit now.',
                noActiveSystemNotice: 'No active beat system selected.',
            },
            stages: {
                preview: 'Preview',
                design: 'Design',
                fields: 'Fields',
            },
            beatNotes: {
                name: 'Beat notes',
                desc: 'Create beat note files in your vault based on the selected story structure system.',
                createText: 'Create beat notes',
                createTooltip: 'Create beat note files in the active book folder',
                repairText: 'Repair beat notes',
                repairTooltip: 'Update Act and Beat Model in frontmatter for misaligned beat notes. Prefix numbers are not changed.',
            },
            beatFields: {
                name: 'Beat fields',
                desc: 'Customize additional properties for beat notes. Enable fields to show in beat hover info. Use the audit below to check conformity across existing beat notes.',
                baseFieldsHeading: 'Base fields (read-only)',
                customFieldsHeading: 'Custom fields',
                dragTooltip: 'Drag to reorder',
                iconPlaceholder: 'Icon name...',
                iconTooltip: 'Lucide icon name for hover synopsis',
                hoverCheckboxTooltip: 'Show in beat hover synopsis',
                keyPlaceholder: 'Key',
                keyRequiredNotice: 'Field key must include letters or numbers.',
                baseFieldNotice: 'is a base beat field. Choose another name.',
                legacyKeyNotice: 'is a legacy beat key. Use "Purpose" instead.',
                keyExistsNotice: 'Key "{{key}}" already exists.',
                commaSeparatedPlaceholder: 'Comma-separated values',
                defaultValuePlaceholder: 'Default value (optional)',
                removeFieldLabel: 'Remove field',
                newKeyPlaceholder: 'New key',
                valuePlaceholder: 'Value',
                addPropertyTooltip: 'Add custom beat property',
                revertTooltip: 'Revert beat properties to default',
            },
            resetModal: {
                badge: 'Warning',
                title: 'Reset beat properties',
                subtitle: 'Resetting will delete all custom beat properties, lucide icons, and restore the defaults.',
                confirmText: 'Are you sure you want to reset? This cannot be undone.',
                resetText: 'Reset to default',
                cancelText: 'Cancel',
            },
            hoverPreview: {
                heading: 'Beat Hover Metadata Preview',
                headingNoneEnabled: 'Beat Hover Metadata Preview (none enabled)',
                enableHint: 'Enable fields using the checkboxes above to show them in beat hover synopsis.',
            },
            library: {
                heading: 'Beat system sets',
                desc: 'Library systems are ready-to-use structural lenses. Saved sets are your own versions you can edit and delete.',
                addSystemLabel: 'Add system',
                selectLabel: 'Select a set',
                narrativeGroup: 'Narrative Frameworks',
                engineGroup: 'Story Engines',
                formatGroup: 'Format Structures',
                savedGroup: 'Saved systems',
                blankGroup: 'Blank / Custom',
                blankSystemTag: 'Blank system',
                librarySystemTag: 'Library system',
                savedSystemTag: 'Saved system',
                loadedStatus: 'Loaded in workspace',
                activeStatus: 'Active in timeline',
                createBlankText: 'Create blank system',
                focusTabText: 'Focus tab',
                openTabText: 'Open tab',
                saveAsCopyText: 'Save as copy',
                resetToDefaultText: 'Reset to default',
            },
            deleteModal: {
                subtitleWithNotes: 'This moves beat notes to trash. The set definition remains available in Add system.',
                scopePrefix: 'Scope: ',
                beatNote: 'beat note',
                warningExtra: 'Any custom properties with values will be lost, including all data entry in non-template fields.',
                warningTemplate: 'Any custom properties with values will be lost, including all data entry.',
                typeDeletePrompt: 'Type DELETE to confirm:',
                cancelText: 'Cancel',
            },
            saveModal: {
                badge: 'BEAT SYSTEM',
                copyTitle: 'Save a copy',
                saveTitle: 'Save set',
                copySubtitle: 'Create an editable copy of this starter set. The original stays unchanged.',
                saveSubtitle: 'Enter a name for this set. Existing sets with the same name will be updated.',
                namePlaceholder: 'Set name',
                saveText: 'Save',
                cancelText: 'Cancel',
                beatNamesNotice: 'Beat names must include letters or numbers before saving a set.',
                noBeatsNotice: 'No beats defined. Add beats before saving.',
                nameRequiredNotice: 'Set name must include letters or numbers.',
            },
            backdrop: {
                name: 'Backdrop properties editor',
                desc: 'Customize additional YAML keys for backdrop notes. Enable fields to show in backdrop hover synopsis.',
                showLabel: 'Show backdrop properties editor',
                hideLabel: 'Hide backdrop properties editor',
                iconTooltip: 'Lucide icon name for hover synopsis',
                hoverCheckboxTooltip: 'Show in backdrop hover synopsis',
                addFieldTooltip: 'Add custom field',
                revertTooltip: 'Clear all custom backdrop fields',
                systemManagedNotice: 'is system-managed. Use "Insert missing IDs" from the audit panel instead.',
                baseFieldNotice: 'is a base field and cannot be used as a custom key.',
                legacyKeyNotice: 'is a legacy backdrop key. Use "Context" instead.',
                hoverPreviewHeading: 'Backdrop Hover Metadata Preview',
                hoverPreviewNoneEnabled: 'Backdrop Hover Metadata Preview (none enabled)',
                hoverPreviewEnableHint: 'Enable fields using the checkboxes above to show them in backdrop hover synopsis.',
            },
            audit: {
                copyTooltip: 'Copy status report to clipboard',
                copiedNotice: 'Audit report copied to clipboard.',
                insertFieldsText: 'Insert missing fields',
                insertFieldsTooltip: 'Add missing custom fields to existing notes',
                insertIdsText: 'Insert missing IDs',
                insertIdsTooltip: 'Insert missing Reference IDs in this scope',
                fixDuplicateIdsText: 'Fix duplicate IDs',
                fixDuplicateIdsTooltip: 'Reassign duplicate Reference IDs in this scope',
                fillEmptyText: 'Fill empty values',
                fillEmptyTooltip: 'Fill empty existing custom beat fields in the active book folder',
                migrateDeprecatedText: 'Migrate deprecated fields',
                migrateDeprecatedTooltip: 'Migrate deprecated YAML keys to canonical fields before cleanup',
                removeUnusedText: 'Remove unused fields',
                removeUnusedTooltip: 'Remove frontmatter fields not defined in the current property rules',
                deleteCustomText: 'Delete custom fields',
                deleteCustomTooltip: 'Remove custom template fields from existing notes (base fields are preserved)',
                reorderText: 'Reorder properties',
                reorderTooltip: 'Reorder frontmatter properties to match the canonical template order',
                saveChangesText: 'Save changes',
                saveChangesTooltip: 'Save changes before running beat audit',
                checkNotesText: 'Check notes',
                healthClean: 'Clean',
                healthMixed: 'Some cleanup needed',
                healthNeedsAttention: 'Missing required properties',
                healthCritical: 'Critical property issues',
                healthUnsafe: 'Unsafe notes detected',
            },
        },
        runtime: {
            header: {
                name: 'Runtime estimation',
                desc: 'Estimate reading, narration, and screenplay runtime across Chronologue Mode, timeline hover, and runtime tools.',
                badgeText: 'Pro',
            },
            contentType: {
                name: 'Content type',
                desc: 'Novel calculates all text at narration pace. Screenplay separates dialogue from action.',
                optionNovel: 'Novel / Audiobook',
                optionScreenplay: 'Screenplay',
            },
            dialogueWpm: { name: 'Dialogue words per minute', desc: 'Reading speed for quoted dialogue.' },
            actionWpm: { name: 'Action words per minute', desc: 'Reading speed for scene descriptions and action lines.' },
            parenthetical: {
                beat: { name: '(beat)', desc: 'Brief pause. Parenthetical timings — seconds added when screenplay directives are detected.' },
                pause: { name: '(pause)', desc: 'Standard pause' },
                longPause: { name: '(long pause)', desc: 'Extended silence' },
                moment: { name: '(a moment)', desc: 'Reflective beat' },
                silence: { name: '(silence)', desc: 'Atmospheric pause' },
                resetTooltip: 'Reset to default',
            },
            narrationWpm: { name: 'Narration words per minute', desc: 'Reading pace for all content (audiobook narration).' },
            writingSchedule: {
                header: {
                    name: 'Writing schedule',
                    desc: 'Estimate how long it will take to finish your manuscript. Used in Pro manuscript exports to project total writing time and session count.',
                    badgeText: 'Pro',
                },
            },
            draftingWpm: { name: 'Drafting words per minute (optional)', desc: 'Your average writing speed. Used to estimate total drafting hours. Leave blank to skip schedule projections.' },
            dailyMinutes: { name: 'Daily writing minutes (optional)', desc: 'How much time you can realistically write each day. Used to estimate total sessions and calendar time. Leave blank to skip schedule projections.' },
            patterns: {
                heading: 'Explicit duration patterns are always parsed and added to runtime:',
                seconds: '(30 seconds) or (30s)',
                minutes: '(2 minutes) or (2m)',
                runtime: '(runtime: 3m)',
                allow: '(allow 5 minutes) — for demos, podcasts',
            },
            profile: {
                defaultSuffix: ' (default)',
                name: 'Profile',
                noneFallback: 'None',
                duplicateTooltip: 'Duplicate profile',
                renameTooltip: 'Rename profile',
                renameTitle: 'Rename profile',
                okButton: 'OK',
                cancelButton: 'Cancel',
                deleteTooltip: 'Delete profile',
                alreadyDefaultTooltip: 'Already default',
                setDefaultTooltip: 'Set as default',
                desc: 'Select, rename, duplicate, delete, or set as default. Current default: {{current}}',
            },
        },
        goalsSessions: {
            header: {
                name: 'Sessions',
                desc: 'Set your drafting pace, session timer target, and writing goals. Radial Timeline uses these values for session tracking, completion planning, and basic estimates.',
            },
            draftingWpm: {
                name: 'Average drafting pace',
                desc: 'Optional words per minute for new drafting. Used for writing-time estimates and completion planning.',
            },
            targetMode: {
                name: 'Daily target type',
                desc: 'Choose whether the session control and writing stats treat the daily target as time, typed words, or both.',
                time: 'Time',
                words: 'Words',
                both: 'Words + time',
            },
            dailyMinutes: {
                name: 'Daily time target',
                desc: 'Optional minutes you want to write each day. Used by the title-bar timer, count ring, daily goal stats, and planning estimates.',
            },
            dailyWords: {
                name: 'Daily word target',
                desc: 'Optional words you want to type each day. Word-mode sessions use this for the live count ring and daily goal stats.',
            },
            weeklyGoalDays: {
                name: 'Weekly writing goal',
                desc: 'How many days per week you want to meet the daily session target.',
            },
        },
        inquiry: {
            contribution: { excluded: 'Excluded', summary: 'Summary', full: 'Full' },
            corpus: {
                errorEmptyMax: 'Empty max must be a non-negative number.',
                errorSketchyMin: 'Sketchy min must be greater than Empty max.',
                errorMediumMin: 'Medium min must be greater than Sketchy min.',
                errorSubstantiveMin: 'Substantive min must be greater than Medium min.',
                resetTooltip: 'Reset CC thresholds',
                name: 'Corpus (CC)',
                desc: 'Highlight content quality and completeness according to your quality standards. Thresholds are based on content-only word counts (frontmatter excluded).',
            },
            prompts: {
                name: 'Inquiry prompts',
                proTag: 'Pro',
                alreadyAddedTag: 'Already added',
                alreadyAdded: 'Already added \u2014 moved to existing question',
                dragToReorder: 'Drag to reorder',
                labelPlaceholder: 'Label (optional)',
                fixedTemplate: 'Fixed template',
                replaceWithTemplate: 'Replace with template',
                applyCanonical: 'Apply selected canonical question',
                resetToCanonical: 'Reset to canonical question',
                deleteQuestion: 'Delete question',
                questionPlaceholder: 'Question text',
                customizedQuestion: 'Customized question',
                unlockProGhost: 'Unlock more custom questions with Pro',
                chooseCanonical: 'Or choose a canonical question',
                noRemainingCanonical: 'No remaining canonical questions',
                addQuestion: 'Add question',
                zoneFullNote: 'Delete a question to add a custom or remaining template question.',
            },
            sources: { name: 'Inquiry sources' },
            booksForInquiry: {
                name: 'Books for Inquiry',
                desc: 'Book Manager defines Inquiry books and their B1/B2/B3 sequence. Folder names stay vault-facing; row order drives traversal.',
                buttonText: 'Open Book Manager',
                ariaLabel: 'Open Book Manager',
            },
            scanRoots: {
                name: 'Supporting material folders',
                desc: 'Inquiry always uses scenes and outlines from Book Manager books. Add folders here only for extra supporting material such as characters, places, heredity, lore, or research.',
                placeholder: '/Character/\n/Place/\n/Heredity/\n/Lore/\n/Research/',
                characterFolder: 'Character folder',
                placeFolder: 'Place folder',
                commonSupportFolders: 'Common support folders',
                tooManyFolders: 'Pattern expands to {{count}} folders; refine your root.',
            },
            materialRules: { name: 'Material rules', desc: 'Define where material lives and how each class participates in Book, Saga, and Reference analysis.' },
            presets: {
                name: 'Presets',
                desc: 'Quick starters for material rules. Apply one, then tweak as needed.',
                default: 'Default',
                light: 'Light',
                deep: 'Deep',
            },
            classTable: { enabled: 'Enabled', class: 'Class', book: 'Book', saga: 'Saga', reference: 'Reference', matches: 'Matches', matchCount: '{{count}} matches' },
            bookStatus: {
                ready: 'Ready',
                missingScenesAndOutline: 'Missing scenes + outline',
                missingScenes: 'Missing scenes',
                missingOutline: 'Missing outline',
            },
            booksTable: {
                sequence: 'Sequence',
                book: 'Book',
                detectedMaterial: 'Detected material',
                status: 'Status',
                empty: 'No Book Manager books are configured yet.',
                materialCounts: '{{sceneCount}} scenes \u00b7 {{outlineCount}} outlines',
            },
            zone: { setup: 'Setup', pressure: 'Pressure', payoff: 'Payoff' },
            modal: { badge: 'INQUIRY', cancel: 'Cancel' },
            canonicalLibrary: {
                name: 'Canonical question library',
                descPro: 'Frame Inquiry across three zones: Setup, Pressure, and Payoff. Add your own custom questions, install curated questions line by line, or load the full Pro set across all zones at once.',
                descFree: 'Frame Inquiry across three zones: Setup, Pressure, and Payoff. Add your own custom questions, install curated questions line by line, or load the curated Core set across all zones at once.',
                loadFullProSet: 'Load Full Pro Set',
                loadAllTooltip: 'Load all canonical Inquiry questions',
                loadCoreQuestions: 'Load Core Questions',
            },
            corpusTable: { tier: 'Tier', threshold: 'Threshold' },
            corpusTier: { empty: 'Empty', sketchy: 'Sketchy', medium: 'Medium', substantive: 'Substantive' },
            config: { name: 'Configuration', desc: 'Pending edit behavior for Inquiry briefs.' },
        },
        authorProgress: {
            hero: {
                badgeRefresh: 'Reminder to Refresh',
                badgeDefault: 'Share \u00b7 Social',
                wikiAriaLabel: 'Read more in the Wiki',
                title: 'Promote your latest work across social media.',
                desc: 'Generate vibrant, spoiler-safe progress graphics for social media and crowdfunding. Perfect for Kickstarter updates, Patreon posts, or sharing your writing journey with fans.',
                keyBenefitsHeading: 'Key Benefits:',
                featureSpoilerSafe: 'Spoiler-Safe \u2014 Scene titles and content are not part of the graphic build process.',
                featureShareable: 'Shareable \u2014 Export as a snapshot in high resolution.',
                featureStageWeighted: 'Stage Progress \u2014 Track advancement via three different modalities',
            },
            preview: {
                sizeLabel: 'APR Preview',
                actualSizePreview: 'Actual size preview',
                teaserAuto: 'Auto (Current Stage)',
                teaserRing: 'Ring',
                teaserScenes: 'Scenes',
                teaserColor: 'Color',
                teaserComplete: 'Complete',
                publish: 'Publish…',
                publishTooltip: 'Open the publisher to update the live file, save a snapshot, or target a campaign.',
                loading: 'Loading preview...',
                lastUpdateNever: 'Never',
                kickstarterReady: 'Kickstarter ready',
                patreonFriendly: 'Patreon friendly',
                emptyState: 'Create scenes to see a preview of your Social report.',
                renderError: 'Failed to render preview.',
                lastUpdate: 'Last update: {{date}}',
            },
            configuration: {
                name: 'Progress tracking',
                desc: 'Select how APR measures your book — one stage at a time, the whole pipeline, or elapsed time.',
                autoUpdateExportPaths: {
                    name: 'Auto-update export paths',
                    desc: 'When size or schedule changes, update default and campaign export paths if they still match the default pattern.',
                },
            },
            styling: {
                name: 'Styling',
                desc: 'Adjust colors, fonts, and borders for your APR. Set the background to transparent or a color to match the background. Use the theme palette (keys to Title color) to apply curated colors across text elements. Or manually edit to taste.',
                choosePaletteButton: 'Choose Palette',
                fontDefault: 'Default (Inter)',
                fontSystemUI: 'System UI',
                weightLight: 'Light (300)',
                weightLightItalic: 'Light Italic',
                weightNormal: 'Normal (400)',
                weightNormalItalic: 'Normal Italic',
                weightMedium: 'Medium (500)',
                weightMediumItalic: 'Medium Italic',
                weightSemiBold: 'Semi-Bold (600)',
                weightSemiBoldItalic: 'Semi-Bold Italic',
                weightBold: 'Bold (700)',
                weightBoldItalic: 'Bold Italic',
                weightExtraBold: 'Extra-Bold (800)',
                weightExtraBoldItalic: 'Extra-Bold Italic',
                weightBlack: 'Black (900)',
                weightBlackItalic: 'Black Italic',
                customFontModal: {
                    customOption: 'Custom...',
                    title: 'Custom font',
                    hint: 'Enter a font family available on your system.',
                    placeholder: 'e.g., EB Garamond',
                    cancel: 'Cancel',
                    save: 'Save',
                },
                autoButton: 'Auto',
                title: {
                    label: 'Title',
                    desc: 'Outer ring book title text. This color is used for the palette seed color.',
                },
                author: {
                    label: 'Author',
                    desc: 'Outer ring author name text.',
                    placeholder: 'Author',
                },
                percentSymbol: { label: '% Symbol', desc: 'Center percent symbol.' },
                percentNumber: { label: '% Number', desc: 'Center progress number.' },
                stageBadge: { label: 'Stage / RT', desc: 'Stage badge typography. The RT logo follows the Publish stage color.' },
                transparentMode: {
                    name: 'Transparent mode',
                    desc: 'No background fill \u2014 adapts to any page or app. Works for PNG and SVG exports on platforms that preserve transparency.',
                },
                backgroundColor: {
                    name: 'Background color',
                    desc: 'Bakes in a solid background. Use when transparency isn\'t reliable: email newsletters, Kickstarter, PDF exports, or platforms that rasterize SVGs.',
                },
                spokesAndBorders: {
                    name: 'Borders',
                    desc: 'Controls scene borders and act division lines. Choose white, black, none, or a custom color.',
                },
                strokeLightStrokes: 'Light Borders',
                strokeDarkStrokes: 'Dark Borders',
                strokeNoStrokes: 'No Borders',
                strokeCustomColor: 'Custom Color',
                strokeSyncBackground: 'Sync to Background',
            },
            publishing: {
                name: 'Publishing & automation',
                updateFrequency: {
                    name: 'Update frequency',
                    desc: 'How often to auto-update the live embed file. "Manual" requires clicking the update button in the Social modal.',
                },
                frequencyManual: 'Manual Only',
                frequencyDaily: 'Daily',
                frequencyWeekly: 'Weekly',
                frequencyMonthly: 'Monthly',
                refreshAlertThreshold: { name: 'Refresh alert threshold', desc: 'Days before showing a refresh reminder in the timeline view. Currently: {{days}} days.' },
                exportPath: { name: 'Export path', desc: 'Location for the live export file. Format follows the Social modal setting.' },
                autoUpdateExportPaths: {
                    name: 'Auto-update export paths',
                    desc: 'When size or schedule changes, update the default export path if it still matches the default pattern.',
                },
                proTeaser: {
                    wantMore: 'Want more?',
                    enhanceWorkflow: 'Enhance your workflow',
                    desc: 'Campaign manager lets you create multiple embeds with Teaser Reveal\u2014progressively show more detail as you write. Get access to Campaign manager and more Pro workflow features including runtime (RT) chronologue mode plus advanced Pandoc publishing templates and customization.',
                    upgradeLink: 'Upgrade to Pro \u2192',
                },
            },
            progressMode: {
                name: 'Progress stage detection & progress mode',
                desc: 'Detects your current progress stage. In new projects, select between a target manuscript length (recommended) or date range.',
                detecting: 'DETECTING\u2026',
                dateRangePlaceholder: 'YYYY-MM-DD to YYYY-MM-DD',
                dateRangeFormat: 'Format: YYYY-MM-DD to YYYY-MM-DD.',
                noScenesFound: 'No scenes found yet; assuming Zero stage.',
                noProgressEstimate: 'No progress estimate available yet.',
                allScenesComplete: 'All scenes complete — manuscript at this stage.',
                basedOnEstimate: 'Based on the progress estimate (active progress stage).',
                errorEnterBothDates: 'Enter both start and target dates (YYYY-MM-DD).',
                errorUseDateFormat: 'Use YYYY-MM-DD for both dates.',
                errorStartBeforeTarget: 'Start date must be before target date.',
                zeroMode: 'Zero Mode (End scene number created by Author)',
                dateTargetMode: 'Date Target Mode',
                guidanceZero: 'Zero Mode (recommended): create a placeholder final scene note with a high prefix number (e.g., "60 The End") to set intended total scene count.',
                guidanceDate: 'Date Mode: choose a start date and target completion date. For example, if you expect to take 10 months to write your book, set a target date that fits that timeline.',
                publishStageAuto: 'Progress Stage (auto)',
                guidancePublishStage: 'Using Progress Stage.',
                stageDetected: '{{stage}} DETECTED',
            },
            attribution: {
                name: 'RT attribution',
                desc: 'Show the Radial Timeline attribution mark and link in Social exports.',
            },
        },
    },
    timelineRepairModal: {
        config: {
            noAiPill: 'No AI · Deterministic',
            title: 'Timeline Scaffold',
            subtitle: 'Fills missing `When` dates in story order so Chronologue can mirror your draft — one date per scene, following the pattern you pick. Dates you have already authored are preserved as anchors. Need to find problems in existing dates instead? Use Timeline Audit.',
            statTotalScenes: 'Total Scenes',
            statWithWhen: 'With Date',
            statMissingWhen: 'Missing Date',
            previewButton: 'Preview Scaffold',
            cancelButton: 'Cancel',
            restoreButton: 'Restore Last Snapshot',
            restoreTooltip: 'Choose a restore point to roll back your timeline dates — the latest was saved {{label}}. A snapshot is captured automatically each time dates are applied, by Scaffold or Audit.',
            restoreEmptyTooltip: 'No snapshot found yet. A snapshot is a restore point that lets you roll back your timeline dates. One is created automatically each time you Apply Scaffolded Dates.',
        },
        express: {
            title: 'Express scaffold',
            desc: 'Fills every missing `When` date in one click, using the anchor and pattern below — scenes keep manuscript order so Chronologue mirrors your draft. Existing dates are untouched, and a snapshot is saved first.',
            button: 'Scaffold & Apply',
            successNotice: 'Dated {{count}} scenes in manuscript order — Chronologue is ready. Snapshot saved.',
            fullyDated: 'All {{count}} scenes already have dates — there is nothing to fill.',
            fullyDatedHint: 'Use Timeline Audit to find problems in existing dates.',
            openAuditButton: 'Open Timeline Audit',
        },
        anchor: {
            name: 'Anchor',
            desc: 'Set the starting date for scene 1.',
            dateLabel: 'Date',
            timeLabel: 'Time',
            pillAuthored: 'authored',
            pillFallback: 'today',
        },
        preview: { name: 'Scaffold preview' },
        pattern: { name: 'Pattern', desc: 'Choose how scenes should be spaced across time.' },
        refinements: {
            name: 'Refinements',
            desc: 'Timeline Scaffold always applies the selected pattern first. Text cues can gently adjust scenes when the manuscript clearly implies a different time.',
            baseScaffoldTitle: 'Base scaffold',
            baseScaffoldDesc: 'Fills missing scene dates using the selected pattern. Existing `When` dates are preserved as anchors.',
            alwaysOn: 'Always on',
            textCuesTitle: 'Text cues',
            textCuesDesc: 'Looks for clear phrases like "next morning" or "three days later" to refine scaffolded `When` dates. Existing dates are not affected.',
        },
        analyzing: {
            badge: 'Beta · Timeline Scaffold',
            title: 'Scaffolding timeline dates...',
            statusApplying: 'Applying pattern spacing...',
            preparing: 'Preparing...',
            abortButton: 'Abort',
            abortedNotice: 'Scaffold aborted',
            phasePattern: 'Applying pattern spacing...',
            phaseCues: 'Checking simple text cues...',
            phaseComplete: 'Scaffold ready',
        },
        review: {
            badge: 'Beta · Timeline Scaffold',
            title: 'Review scaffolded dates',
            subtitle: 'Review the proposed timeline before applying dates to your scenes. Use the filters to focus on cue-adjusted or review-needed scenes. Adjust days or time buckets where the scaffold misses intent.',
            filterNeedsReview: 'Needs Review',
            filterTextCues: 'Cue-adjusted',
            rippleMode: 'Ripple Mode',
            rippleModeHelp: 'Moving a scene to a different day shifts every later scaffolded scene by the same number of days — each keeps its own time of day. Same-day time changes never cascade. Authored dates hold unless "Shift anchored too" is on; flashbacks never move.\nTurn this off to edit scenes independently.',
            rippleAnchoredToggle: 'Shift anchored too ({{count}})',
            rippleAnchoredHelp: 'ON: a ripple cascade also moves the {{count}} authored dates it passes. Flashbacks stay pinned regardless — they belong to another era. OFF: authored dates hold their ground and only scaffolded dates shift.',
            undoTooltip: 'Undo last date edit (Cmd/Ctrl+Z)',
            redoTooltip: 'Redo (Cmd/Ctrl+Shift+Z)',
            historyTooltip: 'Date change history — click an entry to restore the value this scene had before that change.',
            historyEmpty: 'No applied date changes recorded for this scene yet.',
            historyItem: '{{stamp}} · {{prev}} → {{next}} · {{tool}}',
            snapshotAssurance: 'A snapshot of every affected `When` date is saved automatically before applying — restore anytime from the first page.',
            overwriteAuthorDates: 'Overwrite author dates',
            overwriteAuthorDatesHelp: 'OFF preserves existing scene dates and scaffolds around them. ON allows the scaffold to replace existing dates.',
            backButton: 'Back',
            applyButton: 'Apply Scaffolded Dates',
            openAuditButton: 'Open Timeline Audit ({{count}})',
            openAuditButtonAll: 'Open Timeline Audit',
            auditToggleOn: 'Marked for Timeline Audit. Click to remove.',
            auditToggleOff: 'Send this scene to Timeline Audit.',
            narrativePlacement: 'Narrative placement {{count}}',
            chronoPosition: 'Chronological position {{count}}',
            emptyFilter: 'No scenes match the current filters.',
            untitled: 'Untitled',
            warningBackwardTime: 'Backward time',
            warningLargeGap: 'Large time gap',
            warningMissingWhen: 'No existing When date — scaffolded',
            warningDuplicateWhen: 'Another scene shares this exact date and time',
            openInWorkspace: 'Scene is open in your workspace',
            shiftDayBack: 'Shift back 1 day',
            shiftDayForward: 'Shift forward 1 day',
            shiftHourBack: 'Shift back 1 hour',
            shiftHourForward: 'Shift forward 1 hour',
            summaryChanged: '{{count}} changed',
            summaryNeedReview: '{{count}} need review',
            summarySelected: '{{count}} selected',
            summaryAuthored: '{{count}} authored',
        },
        apply: {
            noChangesNotice: 'No changes to apply',
            partialNotice: 'Applied {{success}} changes. {{failed}} failed.',
            successWithSnapshotNotice: 'Applied {{count}} timeline dates. Snapshot saved.',
            snapshotFailedNotice: 'Snapshot could not be saved — Apply aborted to protect your data. ({{message}})'
        },
        restore: {
            successNotice: 'Restored {{restored}} scenes from snapshot ({{label}}).',
            partialOfTotalNotice: 'Restored {{restored}} of {{total}} scenes from snapshot ({{label}}).',
            partialNotice: 'Restored {{restored}} scenes from snapshot ({{label}}). {{failed}} failed.',
            noFrontmatterNotice: '{{count}} scenes have no frontmatter block and were left unchanged: {{paths}}',
            noSnapshotNotice: 'No timeline snapshot found.',
            menuItem: '{{label}} · {{count}} scenes · {{tool}}',
            toolScaffold: 'Scaffold',
            toolAudit: 'Audit'
        },
        reset: {
            button: 'Reset Date Tracking',
            tooltip: 'Start fresh: forget which dates were scaffolded and treat every date as yours. Scene files are not touched.',
            title: 'Reset date tracking',
            body: 'The plugin keeps a private record — outside your scenes — of the `When` dates it has written. Ripple uses it to tell scaffolded dates from yours, and the per-scene history menu reads from it. Resetting clears that record: every date is treated as author-owned, and Ripple will hold all dates unless “Shift anchored too” is on. Your scene files are not changed.',
            note: 'Snapshots are kept — Restore Last Snapshot still works. The cleared record goes to Obsidian’s trash.',
            confirmButton: 'Reset Tracking',
            successNotice: 'Date tracking reset — every date is now treated as yours.'
        },
        confirm: {
            title: 'Confirm Changes',
            warning: 'This action cannot be undone automatically. Make sure you have a backup if needed.',
            applyButton: 'Apply Scaffolded Dates',
            cancelButton: 'Cancel',
            description: 'This will update {{count}} scene file(s) with scaffolded timeline dates.',
        },
    },
    timelineAuditModal: {
        header: {
            badge: 'Beta',
            aiPill: 'AI optional',
            title: 'Timeline Audit',
            subtitle: 'Finds problems in scenes that already have `When` dates. Each scene’s date is checked against its summary, synopsis, and body text to flag contradictions, time-of-day mismatches, and order conflicts — direct text evidence outranks inference. Missing dates entirely? Use Timeline Scaffold to fill them first.',
            aiEnhancedBadge: 'AI-enhanced',
            focusedScope: 'Focused: {{count}} scenes from Timeline Scaffold',
            focusedClear: 'Clear focus',
        },
        loading: {
            title: 'Running instant audit\u2026',
            description: 'Deterministic checks run first and continuity checks run next. The AI chronology scan runs only when you explicitly start it.',
        },
        actions: {
            abort: 'Abort',
            reRunAudit: 'Re-run audit',
            applyAccepted: 'Apply accepted changes',
            close: 'Close',
            snapshotAssurance: 'A snapshot of every affected `When` date is saved automatically before applying — restore from Timeline Scaffold.',
        },
        empty: {
            noResults: 'No audit results available.',
            noFindings: 'No findings match the current filter.',
        },
        scope: { entireVault: 'Entire vault', activeScope: 'Active scope: {{path}}' },
        stats: {
            totalScenes: 'Total scenes',
            aligned: 'Aligned',
            warnings: 'Warnings',
            contradictions: 'Contradictions',
            missingWhen: 'Missing When',
        },
        filters: {
            all: 'All',
            contradictions: 'Contradictions',
            missingWhen: 'Missing When',
            summaryBodyDisagreement: 'Summary/body disagreement',
            continuityProblems: 'Continuity problems',
            aiChecked: 'AI-checked',
            aiSuggested: 'AI-suggested',
            unresolved: 'Unresolved',
        },
        controls: { title: 'Audit actions' },
        bulk: {
            acceptSafe: 'Accept safe suggestions ({{count}})',
            keepAll: 'Keep all as-is',
            markAll: 'Mark all for AI scan',
            scopeNote: 'Bulk actions apply to the {{count}} findings currently listed — combine with the filters above.',
        },
        instantCard: {
            title: 'Instant audit',
            description: 'Runs automatically when this window opens. Checks chronology, summary/body disagreement, and nearby scene continuity.',
            status: 'Already run for the current view.',
            continuityPassToggle: 'Continuity pass',
            continuityPassDesc: 'Checks neighboring scenes for suspicious jumps or impossible order.',
        },
        aiScope: {
            title: 'Scenes AI will read',
            manuscript: 'Entire manuscript',
            range: 'Narrative range',
            marked: 'Marked for AI scan ({{count}})',
            focused: 'From Scaffold ({{count}})',
            fromScene: 'From scene',
            toScene: 'To scene',
            manuscriptSummary: 'Entire manuscript · {{count}} scenes in narrative order',
            rangeSummary: 'Narrative scenes {{start}}–{{end}} · {{count}} scenes',
            markedSummary: '{{count}} scenes marked for AI scan',
            focusedSummary: '{{count}} scenes sent from Timeline Scaffold',
            evidence: 'Uses {{provider}} to read each selected scene’s summary, synopsis, full manuscript text, and adjacent narrative scenes. Existing dates are treated as provisional.',
            providerLocal: 'Local LLM',
            providerConfigured: 'your configured AI provider',
        },
        aiCard: {
            title: 'AI chronology scan',
            aiEnhancedBadge: 'AI-enhanced',
            description: 'Reads the selected manuscript scope in narrative order to recover flashbacks, relative timing, and better date suggestions. Runs in the background and never changes your files — you review every suggestion.',
            actionRunning: 'Running AI chronology scan\u2026',
            actionReRun: 'Re-run AI scan ({{count}})',
            actionStart: 'Run AI scan ({{count}})',
        },
        aiStatus: {
            inProgress: 'AI chronology scan in progress',
            complete: 'AI chronology scan complete',
            failed: 'AI chronology scan failed',
            notStarted: 'AI chronology scan not started',
            runningBackground: 'AI chronology scan is running in the background.',
            failedRetry: 'Try starting the AI chronology scan again.',
            notStartedHint: 'Instant audit is done. Start the AI chronology scan to read the manuscript for subtler timeline problems.',
            progressCount: '{{current}}/{{total}}',
            progressCountWithScene: '{{current}}/{{total}} \u00b7 {{scene}}',
            completedSummary: '{{scope}} · checked {{checked}}/{{requested}} · {{suggestions}} suggestions · {{failed}} failed · {{time}}',
        },
        relativeTime: { justNow: 'just now', minutesAgo: '{{minutes}} min ago', hoursAgo: '{{hours}}h ago', daysAgo: '{{days}}d ago' },
        overview: {
            title: 'Timeline overview',
            legendClean: 'Aligned',
            legendMissingWhen: 'Missing When',
            legendWarning: 'Warning',
            legendContradiction: 'Contradiction',
            legendImpossible: 'Impossible order',
        },
        detail: {
            whatYamlSays: 'What YAML currently says',
            chronologyNotPlaced: 'Not placed in chronological order — the `When` date is missing or invalid.',
            whatManuscriptImplies: 'What the manuscript implies',
            noAlternatePosition: 'No reliable alternate timeline position inferred.',
            noSuggestedWhen: 'No safe replacement When suggested.',
            whyFlagged: 'Why this was flagged',
            whatAuthorCanDo: 'What the author can do',
            actionEligible: 'Apply the suggested When, keep YAML as-is, or mark for review.',
            actionAiSuggestionAvailable: 'AI suggested a replacement When. Review its evidence, then apply it individually or keep the current date.',
            actionIneligible: 'No replacement date can be safely inferred — the text evidence is ambiguous. Keep the current date, mark the scene for review, or set the date manually in the scene’s frontmatter.',
            noEvidence: 'No evidence snippets captured.',
            applyButton: 'Apply',
            keepButton: 'Keep',
            markReviewButton: 'Mark for AI scan',
            noRationale: 'No rationale recorded.',
            whenMissing: 'YAML When: missing from frontmatter.',
            formatWhenMissing: 'Missing',
            chronologyPosition: 'Chronological order: {{position}} of {{total}}',
            suggestedWhen: 'Suggested When: {{when}}',
            aiTimelineRole: 'AI timeline role: {{role}}',
            evidenceLabel: '{{source}} \u00b7 {{tier}}',
            whenInvalid: 'YAML When: invalid in frontmatter ({{raw}}).',
            whenCurrent: 'YAML When: {{when}}.',
            adjustRippleButton: 'Adjust with ripple',
            adjustRippleHelp: 'Opens Timeline Scaffold focused on this scene with Ripple on — nudge its date and every later scene shifts in step. Use Apply instead when only this one scene’s date is wrong.',
        },
        evidenceSource: { summary: 'Summary', synopsis: 'Synopsis', body: 'Body', neighbor: 'Neighbor', ai: 'AI' },
        evidenceTier: { direct: 'Direct text', strongInference: 'Strong inference', ambiguous: 'Ambiguous cue' },
        detectionSource: { deterministic: 'Deterministic', continuity: 'Continuity', ai: 'AI', aiChecked: 'AI checked', aiQueued: 'AI scan queued' },
        timelineRole: { mainline: 'Mainline', flashback: 'Flashback', flashForward: 'Flash-forward', parallel: 'Parallel action', unclear: 'Unclear' },
        notices: { applySuccess: 'Applied timeline audit decisions.', applyPartial: 'Applied timeline audit decisions — {{failed}} failed.', snapshotFailed: 'Snapshot could not be saved — Apply aborted to protect your data. ({{message}})', emptyAiScope: 'No scenes are in the selected AI scan scope.', aiScanAlreadyRunning: 'An AI chronology scan is already running. Showing its progress instead.' },
    },
    timeline: {
        acts: {
            act1: 'ACT I',
            act2: 'ACT II',
            act3: 'ACT III',
            actFallback: 'Act {{number}}',
        },
        /** @deprecated No longer used — book title comes from Book Profiles. */
        workInProgress: 'Untitled Manuscript',
        defaultBookTitle: 'Untitled Manuscript',
        loading: 'Loading timeline...',
        loadingData: 'Loading timeline data...',
        renderError: 'Error rendering timeline. Check console for details.',
        overdue: 'Overdue: {{date}}',
        search: {
            inputLabel: 'Search timeline',
            placeholder: 'Search timeline',
            searchAction: 'Search timeline',
            clearAction: 'Clear timeline search',
            panelLabel: 'Search options',
            scopeLegend: 'Search in',
            scopeTimelineFields: {
                label: 'Timeline fields',
                hint: 'Title, synopsis, and the fields shown on hover',
            },
            scopeBody: {
                label: 'Scene body',
                hint: 'Not available yet',
            },
            assistLabel: 'Local LLM assist',
            assistUnavailable: 'Not available yet',
            statusIdle: 'Press Enter to search',
            statusRunning: 'Searching…',
            statusMatches: '{{count}} scenes matched',
            statusNoMatches: 'No scenes matched',
            statusNoScope: 'Choose where to search',
            statusError: 'Search failed: {{message}}',
        },
        modes: {
            narrative: { name: 'Narrative', acronym: 'N' },
            progress: { name: 'Progress', acronym: 'P' },
            chronologue: { name: 'Chronologue', acronym: 'C' },
            gossamer: { name: 'Gossamer', acronym: 'G' },
        },
        subplotAlignment: {
            groupLabel: 'Subplot alignment',
            fill: { label: 'Fill', tooltip: 'Fill — subplot scenes spread evenly across each act' },
            sequence: { label: 'Sequence', tooltip: 'Sequence — subplot scenes sit at their position in the full manuscript' },
            switchTo: 'Click for {{name}}.',
        },
        subplotRing: {
            allScenes: 'ALL SCENES',
            mainPlot: 'MAIN PLOT',
            chronologue: 'CHRONOLOGUE',
        },
        grid: {
            statusHeader: {
                todo: 'Tdo',
                working: 'Wrk',
                completed: 'Cmt',
                due: 'Due',
            },
            stageHeader: {
                zero: 'Z',
                author: 'A',
                house: 'H',
                press: 'P',
            },
        },
    },
    commands: {
        openTimeline: 'Open',
        openInquiry: 'Open inquiry',
        inquiryOmnibusPass: 'Inquiry omnibus',
        searchTimeline: 'Search timeline',
        createNote: 'Create note\u2026',
        manageSubplots: 'Manage subplots',
        bookDesigner: 'Book designer',
        timelineOrder: 'Timeline scaffold',
        timelineAudit: 'Timeline audit',
        manuscriptExport: 'Manuscript export',
        planetaryTimeCalculator: 'Planetary time calculator',
        gossamerScoreManager: 'Gossamer score manager',
        gossamerAnalysis: 'Gossamer analysis',
        authorProgressReport: 'Author progress report (APR)',
        exportTimelineImage: 'Export timeline as image (SVG / PNG)',
        exportTimelineData: 'Export timeline data (JSON)',
    },
    common: {
        yes: 'Yes',
        no: 'No',
        cancel: 'Cancel',
        save: 'Save',
        reset: 'Reset',
        enable: 'Enable',
        disable: 'Disable',
        loading: 'Loading...',
        error: 'Error',
        success: 'Success',
    },
    notices: {
        settingsSaved: 'Settings saved.',
        invalidInput: 'Invalid input.',
    },
    manuscriptModal: {
        badge: 'Export',
        title: 'Export',
        description: 'Turn your timeline into a precise export file for editing workflows, or into a polished manuscript package. Export clean Markdown in the exact shape you need. Set range and order, split long works into organized files, isolate subplots, and clean up special manuscript formatting. Or export a publication-ready PDF with layout templates, front and back matter, and export checks.',
        heroLoading: 'Loading scenes...',
        heroNarrativeMeta: 'Adjust scene range below.',
        exportHeading: 'Export type',
        exportTypeManuscript: 'Manuscript',
        exportTypeOutline: 'Outline',
        proBadge: 'Enhanced',
        proRequired: 'This export option is not available.',
        proEnabled: 'Export option enabled.',
        manuscriptPresetHeading: 'Manuscript preset',
        presetNovel: 'Novel manuscript',
        presetNovelDesc: 'Formats your scenes into a readable manuscript.',
        presetScreenplay: 'Screenplay',
        presetScreenplayDesc: 'Formats your scenes as a production-ready script.',
        presetPodcast: 'Podcast script',
        presetPodcastDesc: 'Formats your scenes as an audio-production script.',
        outlineBeatSheetDesc: 'Save-the-Cat style beat list from scene metadata.',
        outlineEpisodeRundownDesc: 'Ordered scene rundown with timing-oriented structure.',
        outlineShootingScheduleDesc: 'Production-oriented scene table with location and schedule context.',
        outlineIndexCardsDesc: 'Structured scene data for external tools and automation.',
        formatMarkdown: 'Markdown',
        formatPdf: 'PDF',
        formatDocx: 'Word',
        formatCsv: 'CSV',
        formatJson: 'JSON',
        outlinePresetHeading: 'Outline preset',
        outlineBeatSheet: 'Beat sheet',
        outlineEpisodeRundown: 'Episode rundown',
        outlineShootingSchedule: 'Shooting schedule list',
        outlineIndexCardsCsv: 'Index cards (CSV)',
        outlineIndexCardsJson: 'Index cards (JSON)',
        tocHeading: 'Table of contents',
        tocMarkdown: 'Markdown links (default)',
        tocPlain: 'Plain text',
        tocNone: 'No TOC',
        tocNote: 'Choose a navigation style for the scene list.',
        orderHeading: 'Scene ordering',
        orderNarrative: 'Narrative',
        orderReverseNarrative: 'Reverse',
        orderChronological: 'Chronological',
        orderReverseChronological: 'Reverse chrono',
        orderNote: 'Choose how scenes are ordered in the export.',
        rangeHeading: 'Scene range',
        rangeFirst: 'First scene',
        rangeLast: 'Last scene',
        rangeAllLabel: 'All scenes',
        rangeSingleLabel: 'Single scene',
        rangeSelectedLabel: 'Scenes {{start}}–{{end}}',
        rangeCountLabel: '{{count}} scenes selected',
        rangeStatus: 'Scenes {{start}} – {{end}} of {{total}} ({{count}} selected)',
        rangeLoading: 'Fetching scenes…',
        rangeDecimalWarning: 'Some scene filenames use decimal prefixes. Canonical scene numbering is integer-only; use drag + Ripple Rename to normalize.',
        actionCreate: 'Manuscript generate',
        actionCancel: 'Cancel',
        emptyNotice: 'No scenes available to assemble.',
        templateNotConfigured: '⚠️ Template not configured. PDF will use Pandoc defaults.',
        templateNotFound: '⚠️ Template file not found: {{path}}. Export may fail or use defaults.',
        templateFound: '✅ Template configured: {{path}}',
        configureInSettings: 'Configure in Settings',
        rangeEmpty: 'Selected range is empty.',
        loadError: 'Failed to load scenes.',
        wordCountHeading: 'Update metadata',
        wordCountToggle: 'Update `Words` in scene `YAML`',
        wordCountNote: 'Updates the `Words` field in each scene\'s frontmatter with accurate counts (excludes `YAML` and comments).',
        includeSynopsis: 'Include scene synopsis',
        includeSynopsisNote: 'Adds the Synopsis field from each scene.',
    },
    planetary: {
        heading: 'Planetary calendar system',
        enable: {
            name: 'Enable planetary conversions',
            desc: 'Turns on the converter modal, Chronologue Alt/Option tooltip, and synopsis line for the active profile.',
        },
        active: {
            name: 'Active profile',
            desc: 'Select which planet or setting profile is used for conversions.',
            disabled: '— Disabled —',
        },
        actions: {
            add: 'Add profile',
            delete: 'Delete profile',
        },
        fields: {
            profileName: 'Profile name',
            hoursPerDay: 'Hours per day',
            daysPerWeek: 'Days per week',
            daysPerYear: 'Days per year',
            epochOffset: 'Epoch offset (Earth days)',
            epochLabel: 'Epoch label (optional)',
            monthNames: 'Month names (comma separated)',
            weekdayNames: 'Weekday names (comma separated)',
        },
        preview: {
            heading: 'Quick preview (Earth → local)',
            invalid: 'Enter valid values to see a conversion preview.',
            empty: 'Add a profile to start configuring planetary time.',
            disabled: 'Choose an active profile to preview conversions.',
        },
        modal: {
            title: 'Planetary time converter',
            activeProfile: 'Active profile',
            converterDesc: 'Convert between Earth time and the active planetary calendar.',
            directionLabel: 'Conversion',
            directionDesc: 'Choose which calendar date you know.',
            earthToPlanet: 'Earth → {{planet}}',
            planetToEarth: '{{planet}} → Earth',
            planetFallback: 'Planet',
            earthDatetimeLabel: 'Earth date & time',
            earthDatetimeDesc: 'Select an Earth date and time to convert.',
            planetDateLabel: '{{planet}} date',
            planetDateDesc: 'Choose the local year, month, and day from this planetary calendar.',
            planetTimeLabel: 'Local time',
            planetTimeDesc: 'Choose the local hour and minute for the date you know.',
            yearField: 'Year',
            monthField: 'Month',
            dayField: 'Day',
            hourField: 'Hour',
            minuteField: 'Minute',
            monthFallback: 'Month',
            todayTooltip: 'Fill from the current Earth date and time.',
            datetimeLabel: 'Earth date & time',
            datetimeDesc: 'Select a local date and time to convert.',
            now: 'Now',
            convert: 'Convert',
            noProfile: 'Select an active planetary profile in Settings first.',
            disabled: 'Enable planetary conversions in settings to use this tool.',
            invalid: 'Enter a valid ISO datetime.',
            invalidPlanet: 'Enter a valid planetary date and local time.',
        },
        synopsis: { prefix: 'Local: ' },
        tooltip: { altHint: 'Hold Alt/Option to show local time.' },
    },
    inquiry: {
        help: {
            tooltip: 'How Inquiry Works',
            configTooltip: 'Inquiry is not configured yet.\nPlease configure the Inquiry directories where your scenes, books, and outlines are stored (Settings -> Inquiry).\nThen explicitly check which classes to include for the selected scope.',
            noScenesTooltip: 'No scenes found for the current scope.\nPlease configure the Inquiry directories where your scenes, books, and outlines are stored (Settings -> Inquiry).\nThen explicitly check which classes to include for the selected scope.',
            corpusTooltip: 'Corpus disabled.\nEnable corpus scopes in the Corpus strip to run Inquiry.',
            resultsTooltip: 'Review material citations for granular feedback in the minimap.\nView the Brief for full details.',
            runningTooltip: 'Inquiry is processing an API run.\nYou can switch to another note and keep working while it runs, but leave this Inquiry tab open.',
            runningSingleTooltip: 'Inquiry is processing this question now.\nYou can switch to another note and keep working while it runs, but leave this Inquiry tab open.\nIf you cancel this run, you must start over from the beginning. There is no resume.',
            onboardingTooltip: 'Number buttons reveal the question and payload. Click to process a question with AI. Flow and Depth rings adjust the lens of the response. The minimap reveals contextual citations.',
            noApiKeyTooltip: 'This vault is read-only without an API key.\nOpen a saved session to explore the finished analysis.\nAdd a provider key in Settings → Radial Timeline → AI to run new analyses.',
        },
        mobile: {
            title: 'Desktop required',
            subtitle: 'Inquiry is available on desktop only. Briefs remain readable on mobile.',
            openBriefs: 'Open Briefs folder',
            viewLatest: 'View most recent Brief',
        },
        nav: {
            bookUnresolved: 'Book scope unresolved. Check Inquiry sources.',
            waitingForProvider: 'Waiting for the provider response.',
            backgroundRunInProgress: 'Inquiry run in progress — it will load here when it completes.',
            welcome: 'Welcome to Inquiry. {{weekday}} {{month}} {{day}}{{ordinal}}.',
            previousBook: 'Previous book.',
            nextBook: 'Next book.',
            noPreviousBook: 'No previous book.',
            noNextBook: 'No next book.',
        },
        navTooltip: {
            scopeToggle: 'Toggle between Book and Saga scope.',
            flowLens: 'Switch to Flow lens.',
            depthLens: 'Switch to Depth lens.',
            modeIconToggle: 'Toggle flow and depth lens.',
            focusRingToggle: 'Toggle focus ring expansion.',
            previousBook: 'Previous book.',
            nextBook: 'Next book.',
        },
        runner: {
            contactingProvider: 'Inquiry: contacting AI provider.',
            running: 'Running now ({{evidenceMode}}). Rough ETA {{estimateLabel}}.',
            cancelRequested: 'Inquiry cancel requested. Inquiry will stop after the current pass returns. The active provider request may still complete.',
            finalizing: 'Provider response received. Finalizing the result.',
            waiting: 'Waiting for the provider response.',
            singlePassExceeded: 'This request exceeds the single-pass planning budget. Switch Execution Preference to Automatic, or reduce scope.',
            singlePassFitFailedWithBudget: 'Estimated input {{inputTokens}} exceeded safe input budget {{safeInputTokens}}.',
            singlePassFitFailedUnknown: 'One-pass fit estimate was unavailable, so automatic mode preferred multi-pass analysis.',
            multiPassNotComplete: 'Automatic mode routed to multi-pass because estimated input {{inputTokens}} exceeded safe input budget {{safeInputTokens}}, but chunking/synthesis did not complete.',
            multiPassUnknownNotComplete: 'Automatic mode preferred multi-pass because one-pass fit was unknown, but chunking/synthesis did not complete.',
            multiPassNotCompleteFallback: 'Single-pass response was truncated, and fallback multi-pass analysis did not complete. {{reason}}',
            executionPrecheckFailed: 'Unable to prepare an authoritative provider execution estimate. {{reason}}',
            multiPassFailureGeneric: 'The run failed during multi-pass {{stageLabel}}. RT did not receive valid structured output for a required pass. This is a multi-pass/parsing failure in the current Inquiry path. Open Inquiry Log for details.',
            runAborted: 'Inquiry run aborted.',
            tokenEstimateUnavailable: 'Token estimate unavailable — AI client returned no estimate',
            jsonNotFound: 'Unable to locate JSON in AI response.',
            inquiryAiUnavailable: 'Inquiry AI is unavailable.',
            omnibusReservedForGoogle: 'Combined omnibus is reserved for the canonical Google Inquiry path.',
            inquiryAlreadyRunning: 'Inquiry is already running.',
            inquiryNotConfigured: 'Inquiry is not configured yet.',
            noScenesAvailable: 'No scenes available for Inquiry.',
            noEnabledQuestions: 'No enabled Inquiry questions found.',
            scopeChanged: 'Scope changed since last run.',
            questionSetChanged: 'Question set changed since last run.',
            corpusContributionChanged: 'Corpus contribution settings changed.',
            providerStrategyChanged: 'Provider strategy changed.',
            previousRunCompleted: 'Previous run already completed.',
            stubResultGeneric: 'Deterministic placeholder result.',
            stubResultPreview: 'Preview result for inquiry.',
            aiResponseRecovered: 'AI response recovered from invalid structured output.',
            aiUnsupportedParameter: 'AI request rejected: unsupported parameter.',
            aiRequestRejected: 'AI request rejected.',
            aiAuthError: 'AI request failed: authentication error.',
            aiTimedOut: 'AI request timed out.',
            aiRateLimited: 'AI request rate limited.',
            stubResultUnavailable: 'AI response unavailable; no findings were produced.',
            integrityNoVerified: 'AI citation "{{ref}}" could not be matched to a scene in the active corpus.',
            integrityUnverified: 'AI citation "{{ref}}" could not be matched to the active corpus.',
            unableToBuildEvidence: 'Unable to build evidence blocks.',
            noEvidenceForScope: 'No evidence available for the selected scope.',
            citationsCouldNotBeMatched: 'Inquiry citations could not be matched to this corpus.',
            noSummaryProvided: 'No summary provided.',
            multiPassTriggerReason: 'Single-pass request exceeded the planning budget, so structured multi-pass analysis and synthesis were used.',
            inquiryRunFooter: 'Inquiry chunked execution used {{count}} chunks before synthesis.',
        },
        notice: {
            aiDisabledInSettings: 'Inquiry requires AI features to be enabled. Turn on "Enable AI LLM features" in settings.',
            omnibusViewFailed: 'Unable to open Inquiry view for omnibus pass.',
            omnibusMobileOnly: 'Inquiry omnibus pass is available on desktop only.',
            omnibusResumeNothing: 'All questions already completed. Nothing to resume.',
            omnibusAllSkipped: 'Every question was set to skip — this engine already answered them on the current corpus. Nothing to run.',
            omnibusUnavailable: 'Omnibus unavailable: {{reason}}.',
            omnibusFailed: 'Inquiry omnibus failed: {{message}}',
            running: 'Inquiry running. Please wait.',
            runContinuesInBackground: 'Inquiry is still running. You can return any time — the result will load automatically when you reopen this view.',
            noEnabledQuestions: 'No enabled Inquiry questions found.',
            logNotFound: 'No Inquiry log found for this run.',
            pendingEditsBroken: 'Pending Edits could not be safely updated due to unexpected structure. Please review or reset the Pending Edits section.',
            briefNotFound: 'Brief not found. It may have been moved or deleted.',
            briefSaved: 'Inquiry brief saved.',
            briefSaveFailed: 'Unable to save brief: {{message}}',
            briefFolderFailed: 'Unable to create brief folder.',
            briefNotSaved: 'No brief saved for the active inquiry.',
            noBriefActive: 'No active inquiry brief.',
            sceneNotFound: 'Scene file not found.',
            noRunForPreview: 'Run an inquiry before previewing a report.',
            noRunForSave: 'Run an inquiry before saving a brief.',
            logFolderFailed: 'Unable to create log folder.',
            logSaveFailed: 'Unable to save inquiry log: {{message}}',
            logContentFolderFailed: 'Unable to create inquiry content log folder.',
            logContentSaveFailed: 'Unable to save inquiry content log: {{message}}',
            folderAccessFailed: 'Unable to access folder: {{folderPath}}',
            noBriefs: 'No briefs found.',
            fileExplorerUnavailable: 'File explorer not available.',
            revealFolderFailed: 'Unable to reveal folder.',
            purgedNothing: 'No Inquiry action items found to purge.',
            purgedScenes: 'Purged Inquiry action items from {{count}} {{sceneWord}}.',
            purgedScenesWithRearm: 'Purged Inquiry action items from {{count}} {{sceneWord}}. Re-armed {{rearmCount}} {{sessionWord}}.',
            coreSetLoaded: '{{label}} loaded.',
        },
        interaction: {
            running: 'Inquiry running. Please wait.',
            fieldAlreadyUpdated: '{{fieldLabel}} already updated for this session.',
            runningWaitClear: 'Inquiry running. Please wait to clear recent sessions.',
            runningWaitReset: 'Inquiry running. Please wait to reset corpus overrides.',
            corpusOverridesAlreadyMatch: 'Corpus overrides already match settings.',
            corpusOverridesReset: 'Corpus overrides reset to settings; sessions, logs, and briefs untouched.',
            noCorpusAvailable: 'No corpus available.',
            noScenesInScope: 'No scenes found in current scope.',
            noActionItemsToPurge: 'No Inquiry action items found to purge.',
            noQuestionForSlot: 'No question configured for this slot.',
            noQuestionsForZone: 'No questions configured for this zone.',
            emptyScenesCannotTarget: 'Empty scenes cannot be Target Scenes.',
            onlySceneTicksTargetable: 'Only scene ticks can be targeted.',
            targetScenesBookOnly: 'Target Scenes are available only in Book scope.',
            targetSceneAdded: 'Added to Target Scenes.',
            targetSceneRemoved: 'Removed from Target Scenes.',
            noTargetScenesToClear: 'No Target Scenes to clear.',
            clearedAllTargetScenes: 'Cleared all Target Scenes.',
            corpusDisabled: 'Corpus disabled. Enable corpus to run Inquiry.',
            inquiryAlreadyRun: 'Inquiry already run. Open Recent Inquiry Sessions to reopen.',
            targetScenesBookOnlySaga: 'Target Scenes are book-only. They remain saved and become inactive in Saga scope.',
            lensAlreadyActive: '{{lens}} lens already active.',
            onlyOneSummaryLens: 'Only one summary lens available for this run.',
            cannotCancelFromPreview: 'This run cannot be cancelled from the preview panel.',
            cancelRequested: 'Inquiry cancel requested. Inquiry will stop after the current pass returns. The active provider request may still complete.',
            bookScopeUnresolved: 'Book scope unresolved. Configure a book in settings before running Inquiry.',
            noApiKey: 'Add an API key in Settings → Radial Timeline → AI to run new Inquiry analyses.',
            writebackDisabledSimulated: '{{fieldLabel}} writeback is disabled for simulated runs.',
            noActionItemsThreshold: 'No action items met the writeback threshold.',
            cancelOnlySingleQuestion: 'Cancel is available for active single-question Inquiry runs.',
            pendingEditsUpdatedDefault: 'Pending Edits updated successfully.',
        },
        menu: {
            forceRerun: 'Force Re-run',
            openCitationBriefing: 'Open Citation in Briefing Article',
            openCitationMarkdown: 'Open Citation in Markdown Brief',
            openBriefingArticle: 'Open Briefing Article',
            openBriefMarkdown: 'Open Markdown Brief',
            openScene: 'Open Scene',
            openNote: 'Open Note',
            cancelTargeting: 'Cancel all targeting',
            optionDefaultRun: 'Auto',
            optionStandard: 'Standard',
            optionFocused: 'Focused',
            setFocus: 'Set Focus',
            removeFocus: 'Remove Focus',
            addToTargetScenes: 'Add to Target Scenes',
            removeFromTargetScenes: 'Remove from Target Scenes',
            corpusExclude: 'Exclude',
            corpusSummary: 'Summary',
            corpusFullScene: 'Full Scene',
        },
        findings: {
            findings: 'Findings',
            findingsWithCount: 'Findings · {{label}}',
            oneTargetScene: '1 Target Scene',
            multipleTargetScenes: '{{count}} Target Scenes',
            noInquiryRun: 'No inquiry run yet.',
            runToSeeVerdicts: 'Run an inquiry to see verdicts.',
            verdictBookScoped: '{{label}} saved for Book scope. Switch to Book to use focused inquiry.',
            selectionFocused: 'Selection Mode · Focused · {{targetCount}} target · {{contextCount}} context',
            selectionDiscover: 'Selection Mode · Discover',
            validationMissingTargetRoles: 'Warning: Focused run returned no target-specific findings.',
            scopeNoteTargetBookOnly: 'Target Scenes are book-only and inactive in Saga scope.',
            integrityCompromised: '⚠ Evidence compromised — no verified findings; {{count}} AI {{citationWord}} could not be matched to your manuscript.',
            integrityWarning: '⚠ {{count}} AI {{citationWord}} could not be matched to your manuscript.',
            targetSection: 'Primary Findings',
            contextSection: 'Context Findings',
            unverifiedSection: '⚠ Unverified AI Citations ({{count}})',
            unverifiedWarning: 'These citations are unverified and should not be trusted as evidence.',
            empty: 'None.',
            lens: 'Lens {{label}}',
            unverifiedHeadlinePrefix: '[Unverified] ',
            citedAs: 'Cited: {{descriptor}}',
            referencesNormalized: 'Some scene references were normalized.',
            corpusFingerprintNotAvailable: 'Corpus fingerprint: not available',
            recentSessionsNotAvailable: 'Recent inquiry sessions: not available',
            stubInquiryHeadline: 'Inquiry run failed.',
            stubBulletNote: 'Failure detail: {{message}}',
            stubBulletPlaceholder: 'No analysis findings were produced.',
            previewFooterDismiss: '{{scopeTypeLabel}} {{resultScopeLabel}} · Click to dismiss.',
        },
        preview: {
            footerOpenLog: 'Open Inquiry Log for detailed error report.',
            hoverPreview: 'Hover a question to preview its payload.',
            inquiryNotConfiguredHero: 'Inquiry is not configured.',
            inquiryNotConfiguredHelp: 'Set scan roots and class scope in Settings → Radial Timeline → Inquiry.',
            noApiKeyHero: 'Read-only — no API key.',
            noApiKeyHelp: 'Open a saved session to explore. Add a provider key in Settings → Radial Timeline → AI to run new analyses.',
            noScenesHero: 'No scenes available for Inquiry.',
        },
        details: {
            toggle: 'Toggle details',
        },
        debug: {
            origin: 'ORIGIN',
        },
        corpus: {
            disabled: 'Corpus disabled. Enable corpus to run Inquiry.',
            legendClickKeysTitle: 'CLICK KEYS',
            legendClickCycle: 'Click — cycle scope',
            legendShiftClickToggle: 'Shift + Click — toggle targeting',
            legendRightClickMenu: 'Right + Click — open menu',
            legendModeTitle: 'MODE (icon + color)',
            legendModeFull: 'Full — solid disc (green)',
            legendModeSummary: 'Summary — ring + dot (blue)',
            legendModeExclude: 'Exclude — empty ring (red)',
            legendStatusTitle: 'STATUS (border)',
            legendStatusComplete: 'Complete — solid border',
            legendStatusWorking: 'Working — dotted border',
            legendStatusTodo: 'Todo — dashed border',
            legendStatusOverdue: 'Overdue — red border',
            legendQuestionTitle: 'QUESTION STATES',
            legendQuestionReady: 'Ready — can run',
            legendQuestionRun: 'Result exists — prior run',
            legendQuestionStale: 'Stale — corpus changed',
            legendQuestionProFresh: 'Pro fresh — Pro question ready',
            legendQuestionProRun: 'Pro run — Pro result exists',
            legendQuestionError: 'Error — failed run',
            legendTierTitle: 'TIER (fill level)',
            legendTierSubstantive: 'Substantive — full fill',
            legendTierMedium: 'Medium — partial fill',
            tooltipStatusOverdue: ' (red border)',
            tooltipStatusComplete: ' (solid border)',
            tooltipStatusTodo: ' (dashed border)',
            tooltipStatusWorking: '',
            tooltipModeExclude: 'Mode: Exclude',
            tooltipTargetActive: 'Target Scene: Active',
            tooltipWordsLabel: '{{count}} words',
            statusOverdueLabel: 'Overdue',
            statusTodoLabel: 'Todo',
            statusWorkingLabel: 'Working',
            statusCompleteLabel: 'Complete',
        },
        settingsExtra: {
            autopopulateName: 'Auto-populate Pending Edits',
            autopopulateDesc: 'Automatically write action notes to the Pending Edits yaml field after each Inquiry run. When off, use Recent Inquiry Sessions to write manually.',
            replaceQuestionsTitle: 'Replace current questions?',
            replaceCustomizedQuestionsTitle: 'Replace customized questions?',
            replaceQuestionsConfirm: 'Replace questions',
            replaceCustomTitle: 'Replace custom question?',
            replaceCustomSubtitle: 'Replace this slot with "{{label}}".',
            replaceCustomWarningOne: 'This custom question will be replaced and cannot be recovered.',
            replaceCustomWarningMany: 'Custom questions will be replaced and cannot be recovered.',
            replaceCustomConfirm: 'Replace question',
            replaceCanonicalTitle: 'Replace canonical question?',
            replaceCanonicalSubtitle: 'Replace this slot with "{{label}}".',
            loadCanonicalSubtitleCustomized: 'Load the {{label}}. Existing questions in every zone will be replaced.',
            loadCanonicalSubtitleCurrent: 'Load the {{label}}. Current questions in every zone will be replaced.',
            coreQuestionsLabel: 'Core Questions',
            fullProSetLabel: 'Full Pro Set',
            collapse: 'Collapse',
            expand: 'Expand',
        },
    },
    bookDesigner: {
        saveTemplate: {
            badge: 'SCENE SET',
            title: 'Save scene layout',
            subtitle: 'Name this layout so you can reuse it later.',
            nameField: {
                name: 'Layout name',
                desc: 'Choose a short, unique name.',
                placeholder: 'e.g., Thriller / 3-Act Balanced',
            },
            note: 'Templates capture layout, acts, subplots, characters, beats toggle, and the selected YAML type (base/advanced).',
            nameRequired: 'Template name is required.',
        },
        deleteTemplate: {
            title: 'Delete layout',
            subtitle: 'Delete "{{name}}"? This cannot be undone.',
        },
        demoProject: {
            badge: 'DEMO',
            title: 'Generate nonlinear demo project',
            subtitle: 'Creates a 20-scene, 5-act example to show the difference between narrative order (the order the reader encounters scenes) and chronological order (when events actually happen). The scene numbers run 1–20 in narrative order, but the dates and times jump around — open the START HERE note after generating to see how, and switch between Timeline and Chronologue views to compare.',
            startDate: {
                name: 'Start date',
                desc: 'Used for the chronologue cadence. Format: YYYY-MM-DD.',
            },
            note: 'This will also ensure the workspace is configured for five acts so the demo renders correctly.',
            generate: 'Generate Demo Project',
            invalidDate: 'Use a valid start date in YYYY-MM-DD format.',
        },
        modal: {
            badge: 'SETUP',
            title: 'Book designer',
            subtitle: 'Configure and generate the scaffold for your new novel. Drag scenes in Preview to different acts and subplots to activate manual mode. Save the template to reuse it later.',
            wikiAriaLabel: 'Read more in the Wiki',
            noBookSelected: 'No book selected',
            untitled: 'Untitled',
        },
        meta: {
            autoMode: 'Auto mode',
            manualMode: 'Manual mode',
            manualLayoutActive: 'Manual layout active',
            autoDistribution: 'Auto distribution',
            fromTemplate: ' · From template',
        },
        sections: {
            locationStructure: 'Location & Structure',
            contentConfiguration: 'Content Configuration',
            sceneSetsExtras: 'Scene Sets & Extras',
        },
        fields: {
            targetBook: {
                name: 'Target book',
                desc: 'Choose the Book Manager project where scenes and beats will be created.',
                noBooks: 'No books configured',
                addFirstNote: 'Add a book in Book Manager and set its folder before generating a scaffold here.',
            },
            timeIncrement: {
                name: 'Date increment per scene',
                desc: 'Timeline increment across scenes (e.g. 1 hour, 1 day, 1 week). Set to 0 to disable increments.',
                placeholder: '1 day',
                invalid: 'Invalid duration: "{{raw}}". Reverting to {{current}}.',
            },
            scenes: {
                name: 'Scenes to generate',
                desc: 'Number of template scene files to create with YAML frontmatter.',
            },
            targetLength: {
                name: 'Target book length',
                desc: 'Used for numbering distribution (e.g. 10, 20, 30...)',
                detail: 'Scenes will be numbered: {{examples}}{{suffix}} based on {{scenes}} scenes across {{max}} units.',
            },
            acts: {
                label: 'Acts to distribute scenes across',
                actLabel: 'Act {{num}}',
            },
            subplots: {
                name: 'Subplots',
                desc: 'Enter one subplot per line.',
            },
            characters: {
                name: 'Characters',
                desc: 'Enter one character per line.',
            },
            sceneSet: {
                label: 'Scene set',
                base: 'Base Scene Set',
                advanced: 'Advanced properties',
            },
            generateBeats: {
                withSystem: 'Generate {{name}} beats',
                noSystem: 'No beat system active',
                tooltipNoSystem: 'Select a beat system in Settings → Beats to enable beat generation.',
                existsAria: 'Beat notes already exist in this folder',
                noSystemAria: 'Select a beat system in Settings → Beats first',
                yes: 'Yes',
                no: 'No',
            },
            sceneLayouts: {
                name: 'Scene layouts',
                desc: 'Select a saved layout (acts, subplots, assignments, metadata).',
                newOption: 'New template',
                emptyOption: '—',
            },
        },
        preview: {
            title: 'Preview',
            dragging: 'Dragging scene {{scene}} → Act {{act}}, {{subplot}}',
            subplotFallback: 'Subplot {{num}}',
        },
        buttons: {
            saveSceneSet: 'Save Scene Set',
            reset: 'Reset',
            demoProject: 'Demo Project',
            deleteLayout: 'Delete layout',
            createBook: 'Create Book',
            save: 'Save',
            delete: 'Delete',
            cancel: 'Cancel',
        },
        notes: {
            layoutTemplatesIncludes: 'Includes scenes, acts, subplots, beats, and chronologue timing.',
        },
        notices: {
            layoutReset: 'Layout reset to defaults with auto distribution.',
            templateDeleted: 'Template deleted.',
            templateNotFound: 'Template not found.',
            templateSaved: 'Template "{{name}}" saved.',
            templateUpdated: 'Template "{{name}}" updated.',
            templateApplied: 'Applied template "{{name}}".',
            selectBookForDemo: 'Select a Book Manager book with a folder before generating a demo project.',
            selectBookForGenerate: 'Select a Book Manager book with a folder before generating scenes.',
            folderError: 'Error creating folder: {{error}}',
            baseSetMissing: 'Base scene set not found in settings. Set a scene set before generating.',
            generating: 'Generating {{count}} scenes...',
            beatsExist: 'Beat notes already exist in this folder ({{count}} found). Use the beat manager in settings to repair or resync.',
            noBeatSystemActive: 'No active beat system selected for this book. Choose one in Beat Manager before creating beat notes.',
            beatsError: 'Error creating beats: {{error}}',
            bookCreated: 'Book created! {{scenes}} scenes{{skipped}}{{beats}}.',
            bookCreatedSkipped: ' (skipped {{count}} existing)',
            bookCreatedBeatsExist: ' (beats already exist)',
            bookCreatedBeats: ', {{count}} beat notes',
            demoReady: 'Demo project ready: {{scenes}} scenes, {{notes}} notes, {{beats}} beat notes.{{skipped}}',
            demoSkipped: ' Skipped {{scenes}} existing scenes and {{notes}} existing notes.',
        },
    },
    gossamer: {
        scoreModal: {
            badgePrefix: 'Gossamer {{signal}}',
            beatSystemTitle: '{{label}} beat system',
            subtitle: 'Enter {{signal}} scores (0-100) for each beat. Previous scores will be saved as history.',
            signalMeta: 'Signal: {{label}}',
            beatsDetectedMeta: 'Beats detected: {{count}}',
            noActiveBeatSystem: 'No active beat system selected for this book. Choose one in Beat Manager to score {{signal}} against a specific structure.',
            noBeatsCustom: '⚠️ No custom story beats found. Create notes with "Class: Beat" and "Beat Model: {{label}}", or change beat system in Settings.',
            noBeatsForModel: '⚠️ No story beats found with "Beat Model: {{label}}". Check your beat notes have the correct Beat Model field, or change beat system in Settings.',
            countMismatch: '⚠️ Expected {{expected}} beats for {{label}}, but found {{actual}} story beats with matching Beat Model. Check your vault.',
            enterScoreLabel: 'Enter score',
            scorePlaceholder: '0-100',
            scoreCount: '({{count}} scores)',
            groupMaintenance: 'Maintenance',
            groupAi: 'AI workflow',
            normalizeButton: 'Normalize history',
            deleteButton: 'Delete {{label}} scores',
            deleteAllButton: 'Delete all',
            copyButton: 'Copy AI prompt',
            pasteButton: 'Paste AI response',
            saveButton: 'Save scores',
            cancelButton: 'Cancel',
            aiMetaPrefix: 'Prompt → clipboard · manuscript → ',
            aiMetaVaultLink: 'vault file',
            aiMetaSuffix: ' · {{count}} beats · {{label}}',
            tooltipNormalizeAvailable: 'Compact numbering gaps and drop orphan justifications',
            tooltipNormalizeNone: 'No gaps or orphan justifications detected — nothing to normalize',
            tooltipCopy: 'Assemble prompt (role · rubric · beats · manuscript) and copy to clipboard',
            tooltipPaste: 'Parse clipboard response and save in one step',
            tooltipSave: 'Save manually entered scores',
            tooltipCancel: 'Close without saving',
            normalizeConfirmMessage: 'Will renumber and clean {{count}} beat{{plural}} with gaps or orphaned justifications. RT will archive removed Gossamer fields before cleanup.',
            normalizedDone: 'Normalized Gossamer scores in {{count}} beat{{plural}}.',
            normalizeArchive: 'Archived removed fields: {{path}}',
            normalizeNothing: 'No Gossamer history to normalize.',
            normalizeNoFragments: 'No fragmented scores detected.',
            exportFolderMissing: 'Export folder not found yet — click "Copy AI prompt" to generate a manuscript first.',
            openExplorerSidebar: 'Open the File Explorer sidebar to see the revealed file.',
            explorerNoReveal: 'File explorer does not support reveal.',
            pastePartial: '✓ Pasted {{matched}} of {{expected}} beats. Check for any misnamed rows.',
            pasteSuccess: '✓ Pasted {{matched}} scores + justifications.',
            pasteError: '⚠️ {{reason}} Expected: "Beat Name | 42 | justification"',
            noBookSystem: 'No active beat system selected for this book.',
            noBeatsAvailable: 'No beats available. Add Beat notes with the selected Beat Model first.',
            noScenesInBook: 'No scenes found in the active book folder. Configure the book profile first.',
            manuscriptEmpty: 'Manuscript is empty. Cannot build AI prompt.',
            promptCopied: '✓ Prompt copied to clipboard. Manuscript saved to {{path}} ({{scenes}} scenes · {{words}} words). Paste the prompt into your LLM and upload this file as an attachment.',
            promptCopyFailed: 'Failed to copy AI prompt to clipboard.',
            clipboardReadFailed: 'Could not read clipboard.',
            clipboardEmpty: 'Clipboard is empty.',
            noScoresDetected: 'No scores detected. Expected "Beat Name | 42 | justification" per line.',
            invalidScore: 'Invalid score for "{{title}}"',
            errorsList: 'Errors: {{list}}',
            noChanges: 'No changes to save.',
            updatedCount: 'Updated {{count}} beat(s).',
            saveFailed: 'Failed to save scores. Check console for details.',
            archivedDeletion: 'Archived removed Gossamer fields before cleanup: {{path}}',
            noScoresToDelete: 'No Gossamer {{signal}} scores found to delete.',
            deletedScores: 'Deleted {{label}} scores from {{count}} Beat note(s). Other signal histories untouched.',
            deleteFailed: 'Failed to delete all scores. Check console for details.',
            missingMetadata: 'Missing {{field}} in Beat frontmatter for: {{preview}}{{remainder}}. Update the beat notes to customize the AI template.',
            deleteConfirmBadge: 'Warning',
            deleteConfirmTitle: 'Delete all {{label}} scores',
            deleteConfirmSubtitle: 'RT will archive removed {{label}} slots to the Gossamer log before cleanup. Other signal histories are untouched.',
            deleteConfirmBody: 'This will remove every Gossamer slot whose signal is {{label}} across ALL Beat notes in the active book, including their justifications. Slots belonging to other signals are kept.',
            deleteConfirmButton: 'Delete {{label}} scores',
            deleteConfirmCancel: 'Cancel',
            noGossamerToDelete: 'No Gossamer data found to delete.',
            deletedAllGossamer: 'Deleted all Gossamer data from {{count}} Beat note(s). Every signal history was removed.',
            deleteAllConfirmTitle: 'Delete ALL Gossamer data',
            deleteAllConfirmSubtitle: 'RT will archive every removed Gossamer field to the Gossamer log before cleanup. This resets all beats for a fresh run.',
            deleteAllConfirmBody: 'This will remove EVERY Gossamer slot — all signals (Momentum, Interiority, Activity, Tension) and their justifications — plus legacy Gossamer fields, across ALL Beat notes in the active book. Nothing is kept.',
            deleteAllConfirmButton: 'Delete all Gossamer data',
            normalizeConfirmBadge: 'Warning',
            normalizeConfirmTitle: 'Normalize Gossamer history?',
            normalizeConfirmSubtitle: 'This action cannot be undone. RT archives removed fields before cleanup.',
            normalizeIssuesTitle: 'Beats to normalize',
            normalizeGapLabel: 'Gap',
            normalizeGapsLabel: 'Gaps',
            normalizeOutOfOrder: 'Out-of-order numbering',
            normalizeOrphanLabel: 'Orphaned justification',
            normalizeOrphansLabel: 'Orphaned justifications',
            normalizeWillCompact: 'Will compact numbering',
            normalizeMoreSuffix: '+{{count}} more beat{{plural}} will be cleaned.',
            normalizeConfirmButton: 'Normalize',
            normalizeConfirmCancel: 'Cancel',
        },
        processingModal: {
            statusInitializing: 'Initializing...',
            badge: 'AI {{signal}} analysis',
            title: 'Gossamer {{signal}} analysis',
            backgroundContinues: 'Analysis continues in background.',
            modelDisabled: 'AI disabled',
            confirmSubtitle: 'Evaluate narrative {{signal}} at each story beat. This will pass the selected manuscript evidence to the AI for analysis. The AI does not reference previous scores or justifications, to avoid anchoring bias. The AI will return a score and justification for each beat.',
            gatheringDetails: 'Gathering manuscript details...',
            manuscriptInfoHeading: 'Manuscript Information',
            keyMissing: '⚠️ {{provider}} saved key not configured. Please set your key in Settings → AI.',
            beginButton: 'Begin Analysis',
            cancelButton: 'Cancel',
            analyzingManuscript: 'Analyzing manuscript...',
            assemblingManuscript: 'Assembling manuscript...',
            statusHeading: 'Status',
            waitingToSend: 'Waiting to send...',
            advancedHeading: 'AI prompt & context',
            closeButton: 'Close',
            waitingFirstRequest: 'Waiting for first AI request...',
            statScenes: 'Scenes',
            statWords: 'Words',
            statCorpusTokens: 'Corpus Tokens',
            statBeats: 'Story Beats',
            statEvidence: 'Evidence',
            evidenceDefault: 'Auto (scene bodies first)',
            beatSystemLine: 'Beat System: {{name}}',
            timerElapsed: 'Elapsed {{time}}',
            timerLongerThanExpected: ' · running longer than expected (est. ~{{seconds}}s)',
            timerEstimate: ' · est. ~{{seconds}}s',
            timerTypical: ' · typically 30–90 seconds',
            apiFailed: '✗ API call failed',
            errorsHeader: 'Errors encountered:',
            errorLogLinkLabel: 'Run log: ',
            analysisComplete: 'Analysis complete',
            analysisFailed: 'Analysis failed',
            rateLimitWithRetry: 'Rate limit reached. Please try again in {{seconds}} seconds.',
            rateLimit: 'Rate limit reached. Please try again later.',
            rateLimited: '⚠️ Rate limited',
            advRoleTemplate: 'Role template: {{value}}',
            advResolvedModel: 'Resolved model: {{provider}} -> {{alias}} ({{label}})',
            advModelSelectionReason: 'Model selection reason: {{value}}',
            advAvailabilityVisible: 'Visible to your key ✅',
            advAvailabilityNotVisible: 'Not visible ⚠️',
            advAvailabilityUnknown: 'Unknown (snapshot unavailable)',
            advAvailability: 'Availability: {{value}}',
            advAppliedCaps: 'Applied caps: input={{input}}, output={{output}}',
            advTokenEstimate: 'Token estimate: {{count}} via {{method}}',
            advTokenEstimateUnavailable: 'Token estimate: unavailable',
            advPackaging: 'Packaging: Automatic',
            advEvidence: 'Evidence: {{value}}',
            advFinalPromptLabel: 'Final composed prompt:',
            advFinalPromptNone: '(none)',
            advPassCount: 'Pass count: {{value}}',
            advMultiPassTrigger: 'Multi-pass trigger: {{value}}',
        },
        notices: {
            noStoryBeats: 'No story beats found. Create notes with frontmatter "Class: Beat".',
            cannotEnterMode: 'Cannot enter Gossamer mode. {{hint}}',
            systemHintWithModel: 'No "{{system}}" beat notes found in your vault. Create beat notes with "Class: Beat" and "Beat Model: {{system}}" in frontmatter.',
            systemHintNoModel: 'No story beats found. Create notes with frontmatter "Class: Beat".',
            modeMatchHintWithModel: 'No beat notes found matching "{{system}}". Check that your beat notes have "Beat Model: {{system}}" in frontmatter.',
            modeMatchHintNoModel: 'No story beat notes could be matched. Ensure notes have "Class: Beat" in frontmatter.',
            noScoresInfo: 'No Gossamer {{signal}} scores found. Showing ideal ranges and spokes. Add scores using the Gossamer score-entry command.',
            modeToggleSwitchMain: 'Switch to Main Plot mode',
            modeToggleSwitchAll: 'Switch to All Scenes mode',
            noActiveBeatSystemRun: 'No active beat system selected for this book. Choose one in Beat Manager before running Gossamer.',
            validating: 'Validating configuration...',
            loadingBeats: 'Loading story beats...',
            assemblingEvidence: 'Assembling manuscript evidence...',
            assemblingEvidenceWithMode: 'Assembling manuscript evidence ({{mode}})...',
            noScenesInBook: 'No scenes found in the active book folder.',
            noSceneBodyContent: 'No scene body content available for analysis.',
            buildingPrompt: 'Building analysis prompt...',
            sendingToAi: 'Sending manuscript to AI for {{signal}} analysis...',
            aiResponseError: 'Failed to get response from AI',
            updatingBeats: 'Updating beat notes...',
            archivedSnapshot: 'Archived replaced Gossamer history before save (1 snapshot).',
            generatingLog: 'Generating analysis log...',
            successUpdated: '✓ Updated {{count}} beats with {{signal}} scores',
            successLogWithContent: '{{message}}. Log saved to {{path}} (evidence: {{mode}}).',
            successLogWithoutContent: '{{message}}. Summary log saved to {{path}}. Content logs are disabled.',
            processingFailed: 'Processing failed: {{error}}',
            aiAnalysisFailed: 'Failed Gossamer AI analysis: {{error}}',
            prepareFailed: 'Failed to prepare Gossamer analysis: {{error}}',
            retryGemini: 'Retry or check Gemini API configuration.',
            unmatchedBeats: 'Could not match {{count}} beat(s): {{list}}',
            validationFailed: 'AI response did not match submitted beats ({{count}} issue(s)) — no scores were written. See the Gossamer log for details.',
        },
        service: {
            updatedBeatScoresPlural: 'Updated {{count}} beat scores ({{stage}} stage).',
            updatedBeatScoreSingular: 'Updated {{count}} beat score ({{stage}} stage).',
            archivedSingleSnapshot: 'Archived replaced Gossamer history in 1 snapshot.',
            noBeatsUpdated: 'No beats were updated.',
            updatedBeatScores: 'Updated {{count}} beat scores ({{stage}} stage).',
            archivedWithPath: 'Archived replaced Gossamer history: {{path}}',
        },
    },
    sceneAnalysis: {
        confirm: {
            badge: 'Confirm',
            title: 'Confirm action',
            continueButton: 'Continue',
            cancelButton: 'Cancel',
        },
        processingModal: {
            titleSummaryRefresh: 'Summary refresh',
            titleScenePulse: 'Scene pulse analysis',
            titleProcessingSubplot: 'Processing subplot: {{name}}',
            titleProcessingEntireSubplot: 'Processing entire subplot: {{name}}',
            badgeAiSummary: 'AI Summary',
            badgeAiPulseRun: 'AI Pulse Run',
            subtitleSynopsis: 'Generates Inquiry corpus summaries and writes each scene immediately as it completes. Existing Summary values are replaced (and Synopsis too if enabled).',
            subtitleEntireSubplot: 'Analyzing every scene in subplot "{{name}}"',
            subtitleFlaggedSubplot: 'Analyzing flagged scenes in subplot "{{name}}"',
            modeUnprocessed: 'Scenes missing pulse metadata',
            modeForceAll: 'Reprocessing every completed scene',
            modeFlagged: 'Analyze flagged scenes in manuscript order',
            modeSynopsisFlagged: 'Update flagged scenes',
            modeSynopsisMissingWeak: 'Update missing, weak, or stale summaries',
            modeSynopsisMissing: 'Update missing summaries only',
            modeSynopsisAll: 'Regenerate ALL summaries',
            modeOptions: {
                synopsisFlaggedTitle: 'Selected scenes (Summary Update: yes)',
                synopsisFlaggedDesc: 'Processes scenes with Summary Update: yes in frontmatter.',
                synopsisMissingTitle: 'Missing only',
                synopsisMissingDesc: 'Only processes scenes with absolutely no summary text.',
                synopsisMissingWeakTitle: 'Missing, weak, or stale (Recommended)',
                synopsisMissingWeakDesc: 'Processes scenes with no summary, under {{threshold}} words, or with a Due date newer than last AI update.',
                synopsisAllTitle: 'Regenerate all (Warning)',
                synopsisAllDesc: 'Regenerates summaries for every scene. Existing summaries will be overwritten.',
                openTitle: 'Process open scenes',
                openDesc: 'Processes scenes currently open in tabs (Status: Working or Complete). Use while actively editing — ignores the Pulse Update flag.',
                flaggedTitle: 'Process flagged scenes (Recommended)',
                flaggedDesc: "Processes scenes with Pulse Update: Yes and Status: Working or Complete. Use when you've revised scenes and want to update their pulse.",
                unprocessedTitle: 'Process unprocessed scenes',
                unprocessedDesc: "Processes scenes with Status: Complete or Working that don't have pulse yet. Perfect for resuming after interruptions. Ignores Pulse Update flag.",
                forceAllTitle: 'Reprocess ALL scenes',
                forceAllDesc: 'Reprocesses ALL scenes with Status: Complete or Working, even if they already have pulse. Use when changing AI templates or doing complete reanalysis. WARNING: May be expensive!',
            },
            controls: {
                targetLengthLabel: 'Target summary length',
                targetLengthHelp: 'Target word count for Summary refresh. Each completed scene is written immediately to frontmatter.',
                weakThresholdLabel: 'Treat summary as weak if under',
                weakThresholdHelp: 'Only used to decide which scenes are selected for update.',
                alsoUpdateSynopsis: 'Also update Synopsis',
                alsoUpdateSynopsisHelp: 'Also replace Synopsis with a concise version generated from scene content. Current stored length target is {{words}} words. Hover may use a little more when space allows.',
                synopsisLengthInvalid: 'Synopsis length must be between 10 and 300 words.',
                thresholdWarning: '⚠️ Target size ({{target}}) is less than weak threshold ({{threshold}}). Newly generated summaries may be immediately classified as weak.',
            },
            count: {
                calculating: 'Calculating...',
                scenesToProcessLabel: 'Scenes to process: ',
                estimatedTimeLabel: 'Estimated time: ',
                estimatedTimeValue: '~{{minutes}} minutes',
                largeBatchWarning: 'Large batch processing may take significant time and API costs.',
                errorCalculating: 'Error calculating scene count: {{error}}',
            },
            buttons: {
                start: 'Start processing',
                purge: 'Purge all pulse',
                cancel: 'Cancel',
                abort: 'Abort processing',
                close: 'Close',
                applyChanges: 'Apply {{count}} Changes',
                discard: 'Discard',
                resume: 'Resume ({{remaining}} remaining)',
            },
            confirmLargeBatch: 'You are about to process {{count}} scenes. This may take {{minutes}} minutes and incur API costs. Continue?',
            queue: {
                title: 'Scene queue',
                empty: 'Queue builds once eligible scenes are found...',
                noteSynopsis: 'Processing scenes to generate or update summaries based on scene content.',
                notePulse: 'Triplets animate as the AI advances - starts, endings, and missing scenes handled automatically.',
                previousLabel: 'Previous',
                currentLabel: 'Current',
                nextLabel: 'Next',
                startOfBoundary: 'Start of {{boundary}}',
                endOfBoundary: 'End of {{boundary}}',
                boundaryManuscript: 'manuscript',
                boundarySubplot: 'subplot',
                unnumberedScene: 'Unnumbered scene',
            },
            progress: {
                initializing: 'Initializing… preparing first scene (0%)',
                initializingPipeline: 'Initializing pipeline...',
                sceneProgress: '{{current}} / {{total}} scenes ({{percentage}}%)',
                processingScene: 'Processing: {{sceneName}}',
                processingSceneEstimate: 'Processing: {{sceneName}} (~{{seconds}}s)',
                progressSummary: '{{success}} / {{total}} scenes updated',
                progressSummarySingle: '{{count}} scene updated',
                progressSummaryPlural: '{{count}} scenes updated',
                failedCount: '{{count}} failed',
                skippedCount: '{{count}} skipped',
            },
            apply: {
                review: 'Review and apply changes',
                messageSummary: 'Processing complete. {{count}} scenes have new summaries ready to apply, and applying will replace existing Summary values in frontmatter.',
                messageSummaryAndSynopsis: 'Processing complete. {{count}} scenes have new summaries and synopses ready to apply, and applying will replace existing Summary and Synopsis values in frontmatter.',
                applyingUpdates: 'Applying {{count}} summary updates...',
                applyingUpdatesSynopsis: 'Applying {{count}} summary & synopsis updates...',
                successUpdated: 'Successfully updated {{count}} scenes.',
                applyError: 'Error applying changes. Check console.',
                artifactSummary: 'summaries',
                artifactSummaryAndSynopsis: 'summaries and synopses',
            },
            completion: {
                aborted: 'Processing aborted',
                successMessage: 'Processing completed successfully!',
                partialMessage: 'Processing finished with errors',
                failedMessage: 'Processing failed',
                stoppedDueToError: 'Processing stopped due to error',
                fatalError: 'Fatal error: {{error}}',
                processingDetailsHeading: 'Processing details',
                errorsCount: 'Errors: {{count}}',
                warningsCount: 'Warnings: {{count}} (skipped due to validation)',
                possibleFix: 'Possible fix: {{hint}}',
                logsSaved: 'Logs saved to {{path}}. Scene properties updated.',
                logsNoRequest: 'Logging is enabled, but no AI request reached the server. Scene properties updated.',
                issuesContinue: 'Issues encountered (processing continues):',
                issuesAfter: 'Issues encountered:',
            },
            abort: {
                confirmMessage: 'Are you sure you want to abort processing? Progress will be saved up to the current scene.',
                aborting: 'Aborting... Please wait.',
                stoppedDueToError: 'Processing stopped due to error',
                noticeAbortedByUser: 'Processing aborted by user',
            },
            errorHints: {
                temperatureDefault: 'This model only accepts its default temperature. Remove the custom temperature override in Settings → AI Providers.',
                modelNotFound: 'Verify that the selected Local LLM model is available on the configured backend and update the Local LLM model ID in settings to match exactly.',
                ollamaNotResponding: 'Launch the {{backend}} server and confirm the Local LLM base URL points to the running endpoint.',
                connectionRefused: 'The plugin could not contact the local server. Check that it is running and that Obsidian has network permission.',
                schemaJson: 'The response was not valid JSON. Try switching to a larger or more instruction-following model.',
                contextTooLong: 'This pass exceeded the model budget for that request. Summary refresh sends the full scene text, and optional Synopsis adds a second full-scene pass. Processing continues; only this scene/pass failed.',
            },
            aiAdvanced: {
                summary: 'AI prompt & context',
                waiting: 'Waiting for first AI request...',
                roleTemplate: 'Role template: {{name}}',
                resolvedModel: 'Resolved model: {{provider}} -> {{alias}} ({{label}})',
                modelSelectionReason: 'Model selection reason: {{reason}}',
                availabilityVisible: 'Visible to your key ✅',
                availabilityNotVisible: 'Not visible ⚠️',
                availabilityUnknown: 'Unknown (snapshot unavailable)',
                availabilityLabel: 'Availability: {{status}}',
                appliedCaps: 'Applied caps: input={{input}}, output={{output}}',
                estimatedInput: 'Estimated input: ~{{tokens}} tokens',
                packagingAuto: 'Packaging: Automatic',
                finalPrompt: 'Final composed prompt:',
                none: '(none)',
                passCount: 'Pass count: {{count}}',
                multiPassTrigger: 'Multi-pass trigger: {{reason}}',
            },
            synopsisPreview: {
                previousLabel: 'Previous Summary: ',
                noSummary: '(No summary)',
                generating: 'Generating...',
            },
            unknownError: 'Unknown error',
            warningEncountered: 'Warning encountered',
            backgroundProcessing: 'Processing continues in background. Use command palette to reopen progress window.',
            noScenesSelected: 'No scenes to process with the selected mode.',
            errorPrefix: 'Error: {{error}}',
        },
        runtimeModal: {
            badgePro: 'PRO',
            badgeAudiobook: 'Audiobook',
            badgeScreenplay: 'Screenplay',
            badgeRuntime: 'Runtime · {{mode}}',
            badgeRuntimeEstimator: 'Runtime estimator · {{mode}}',
            title: 'Runtime estimation',
            titleProgress: 'Estimating Runtimes...',
            subtitle: 'Algorithmic word-count analysis. Calculates runtime from scene text using configured WPM rates and parenthetical timing.',
            sections: {
                scope: 'Scope',
                scopeDesc: 'Select which scenes to process for runtime estimation.',
                statusFilter: 'Scene Status Filter',
                statusFilterDesc: 'Only scenes with the selected status will be processed.',
                override: 'Override',
                overrideDesc: 'By default, only scenes without a Runtime value are processed.',
                settings: 'Estimation Settings',
                mode: 'Estimation Mode',
                summary: 'Summary',
            },
            statusFilter: {
                todo: 'Todo',
                working: 'Working',
                complete: 'Complete',
            },
            scope: {
                current: 'Current scene',
                subplot: 'Subplot scenes',
                all: 'All scenes',
                subplotLabel: 'Subplot:',
                sceneLabel: 'Scene: ',
                noSceneOpen: 'No scene open',
            },
            override: {
                recalculate: 'Recalculate all',
                recalculateHint: 'Replaces existing Runtime values, including manual estimates you may have entered.',
            },
            settings: {
                accordionTitle: 'Estimation Settings',
                accordionHint: '({{mode}})',
                profileLabel: 'Profile:',
                dialogueRateLabel: 'Dialogue rate:',
                actionRateLabel: 'Action/Description rate:',
                narrationRateLabel: 'Narration rate:',
                wpmValue: '{{value}} wpm',
                parentheticalTimingsHeader: 'Parenthetical Timings',
                timingBeat: '(beat)',
                timingPause: '(pause)',
                timingLongPause: '(long pause)',
                timingMoment: '(a moment)',
                timingSilence: '(silence)',
                secondsValue: '{{value}}s',
                configHint: 'Configure these values in Settings → Pro → Runtime estimation',
            },
            modes: {
                local: 'Local',
                ai: 'AI',
                localDesc: 'No data sent externally. Runtime calculated locally using word counts, configured WPM rates, and parenthetical timing directives.',
                aiDesc: 'Each scene sent to {{provider}} along with local stats. AI analyzes pacing and context to estimate runtime. Writes AI estimate to each scene.',
            },
            provider: {
                aiDisabled: 'AI disabled',
                providerLabel: '{{provider}} ({{model}})',
                providerLabelLocal: '{{provider}} ({{model}} @ {{baseUrl}})',
            },
            count: {
                calculating: 'Calculating...',
                scenesToProcessLabel: 'Scenes to process: ',
                hintCurrent: 'Open a scene file to estimate its runtime.',
                hintNoStatus: 'Select at least one status filter.',
                hintAlreadyRuntime: 'All matching scenes already have Runtime values. Enable "Override existing" to recalculate.',
                errorPrefix: 'Error: {{error}}',
            },
            buttons: {
                settingsTooltip: 'Open runtime settings',
                estimate: 'Estimate Runtimes',
                cancel: 'Cancel',
                abort: 'Abort',
                close: 'Close',
            },
            progress: {
                initializing: 'Initializing...',
                initialProgress: '0 / {{total}} scenes (0%)',
                runningTotalLabel: 'Running total: ',
                runningTotalDefault: '0:00',
                sceneProgress: '{{current}} / {{total}} scenes ({{percentage}}%)',
                processingScene: 'Processing: {{sceneName}}',
                scenesProcessed: '{{count}} scenes processed',
            },
            completion: {
                successMessage: 'Estimation completed successfully!',
                aborted: 'Estimation aborted',
                errorPrefix: 'Error: {{error}}',
                aiEstimateReady: 'AI estimate ready.',
                aiErrorPrefix: 'AI error: {{error}}',
                localAiCompare: 'Local: {{local}} · {{aiLabel}}: {{aiRuntime}}{{deltaText}}',
            },
            aiAdvanced: {
                summary: 'AI prompt & context',
                waiting: 'Waiting for first AI request...',
                roleTemplate: 'Role template: {{name}}',
                resolvedModel: 'Resolved model: {{provider}} -> {{alias}} ({{label}})',
                modelSelectionReason: 'Model selection reason: {{reason}}',
                availabilityVisible: 'Visible to your key ✅',
                availabilityNotVisible: 'Not visible ⚠️',
                availabilityUnknown: 'Unknown (snapshot unavailable)',
                availabilityLabel: 'Availability: {{status}}',
                appliedCaps: 'Applied caps: input={{input}}, output={{output}}',
                packagingAuto: 'Packaging: Automatic',
                finalPrompt: 'Final composed prompt:',
                none: '(none)',
                passCount: 'Pass count: {{count}}',
                multiPassTrigger: 'Multi-pass trigger: {{reason}}',
            },
            notices: {
                background: 'Processing continues in background.',
                aborting: 'Aborting...',
                aiAnalyzing: 'AI analyzing: {{title}}',
            },
        },
        pipeline: {
            notices: {
                processingSubplotInit: 'Processing Subplot: Getting scene data...',
                analyzingSubplot: 'Analyzing {{count}} scenes for subplot order...',
                sceneStatusSkip: 'Scene {{sceneRef}} (subplot {{subplot}}) has Pulse Update set but Status is not working/complete. Skipping.',
                processingScene: "Processing scene {{num}} ({{current}}/{{total}}) - Subplot: '{{name}}'...",
                progressUpdate: 'Progress: {{current}}/{{total}} scenes processed...',
                subplotComplete: 'Subplot order processing complete: {{processed}}/{{total}} triplets processed.',
                subplotErrorGeneric: 'Error processing subplots. Check console for details.',
                noSubplotScenes: 'No scenes with subplots found.',
                noScenesValid: 'No valid scenes found in the active book folder.',
                noFlaggedSubplotScenes: 'No flagged scenes (Pulse Update: Yes/True/1) with content found for "{{name}}".',
                noScenesForSubplot: 'No scenes found for subplot "{{name}}".',
                noScenesContentSubplot: 'No scenes with content found for subplot "{{name}}".',
                noRemainingResumingSubplot: 'No remaining scenes to process for subplot "{{name}}" (all may have been processed today).',
                noFlaggedPulseUpdateSubplot: 'No flagged scenes (Pulse Update: Yes) with content found for subplot "{{name}}".',
                abortedByUser: 'Processing aborted by user',
                abortedRateLimit: 'Processing aborted by user or rate limit',
                fatalError: 'Fatal error: {{error}}',
            },
            errors: {
                failedUpdate: 'Failed to update file for scene {{num}}: {{path}}',
                aiProcessingFailed: 'AI processing failed for scene {{num}}: {{path}}',
                fatalScene: 'Fatal error while processing scene {{num}}: {{path}}\n{{detail}}',
                localLlmReview: 'Local LLM result needs review for scene {{num}}: {{path}}. See logs.',
            },
        },
        maintenance: {
            yamlTest: {
                starting: 'Starting YAML update test on {{file}}...',
                errorTfile: 'Error: Could not get TFile for {{file}}',
                errorMissingFm: 'Error: Dummy file {{file}} is missing frontmatter.',
                errorParse: 'Error: Failed to parse dummy API response data.',
                success: 'Successfully updated YAML in {{file}}. Please check the file formatting.',
                failed: 'Failed to update YAML in {{file}}. Check console for errors.',
                errorGeneric: 'Error during YAML update test. Check console.',
            },
            purge: {
                badgeWarning: 'Warning',
                title: 'Confirm purge beats',
                subtitle: 'RT will archive removed scene-analysis fields before cleanup.',
                dangerHeader: 'This will remove these fields and archive them to a log snapshot first:',
                areYouSure: 'Are you sure you want to proceed?',
                buttonPurge: 'Purge beats',
                buttonCancel: 'Cancel',
                noScenes: 'No scenes found in manuscript.',
                confirmManuscript: 'Purge ALL beats from {{count}} scene{{plural}} in your manuscript?',
                confirmSubplot: 'Purge beats from {{count}} scene{{plural}} in subplot "{{name}}"?',
                detailFields: '`previousSceneAnalysis`, `currentSceneAnalysis`, `nextSceneAnalysis` fields',
                detailPulseUpdate: '`Pulse Update` timestamp',
                detailPulseLastUpdated: '`Pulse Last Updated` timestamps',
                noticeStart: 'Purging beats from all scenes...',
                noticeStartSubplot: 'Purging beats from "{{name}}"...',
                resultManuscript: 'Purged beats from {{purged}} of {{total}} scene{{plural}}.',
                resultSubplot: 'Purged beats from {{purged}} of {{total}} scene{{plural}} in subplot "{{name}}".',
                archived: 'Archived removed fields: {{path}}',
                errorGeneric: 'Error purging beats. Check console for details.',
            },
            saveError: 'Error saving updates to {{file}}',
        },
        synopsis: {
            notices: {
                reopeningSession: 'Reopening active processing session...',
                noScenesScope: 'No scene notes found in the active book scope.',
                scopeMessage: 'Summary refresh scope: {{scope}}',
                noMatchingScenes: 'No scenes found matching the selected criteria.',
                sceneFileNotFound: 'Scene file not found: {{path}}',
            },
            aiErrors: {
                aiError: 'AI Error: {{name}}',
                jsonParseError: 'JSON Parse Error: {{name}}',
                emptyResult: 'Empty result: {{name}}',
                synopsisFailed: 'Synopsis generation failed for {{name}}. Summary was saved and processing continued. {{reason}}',
                saveError: 'Save error for {{name}}: {{message}}',
                summaryFailed: 'Summary generation failed for {{name}}. Processing continued with remaining scenes. {{reason}}',
                contextTooLongWithSize: 'The {{pass}} request exceeded the model budget for this pass. Scene text was about {{words}} words. Summary refresh sends the full scene text, and optional Synopsis sends another full-scene request.',
                contextTooLongNoSize: 'The {{pass}} request exceeded the model budget for this pass. Summary refresh sends the full scene text, and optional Synopsis sends another full-scene request.',
                unknownPassFailure: 'Unknown {{pass}} failure.',
            },
        },
        service: {
            commands: {
                summaryRefresh: 'Summary refresh',
                scenePulseManuscript: 'Scene pulse analysis (manuscript order)',
                scenePulseSubplot: 'Scene pulse analysis (subplot order)',
                runtimeEstimator: 'Runtime estimator',
            },
            notices: {
                noSubplots: 'No subplots found.',
                aiDisabled: 'AI Strategy is disabled. Choose an AI provider in Settings → AI.',
                localLlmDisabled: 'Local LLM is disabled. Enable it in Settings → AI.',
                localLlmRequiresUrl: 'Local LLM requires a base URL and model selection.',
                providerKeyMissing: '{{provider}} saved key is not set in settings.',
            },
            subplotPicker: {
                title: 'Process subplot scenes',
                subtitle: 'Choose a subplot and run pulse updates just for that arc.',
                badge: 'AI pulse run',
                badgeWith: 'AI pulse run · {{model}}',
                flaggedScenes: 'Flagged scenes',
                processableScenes: 'Processable scenes',
                totalScenes: 'Total scenes',
                pickLabel: 'Select a subplot to process',
                processFlagged: 'Process flagged scenes',
                processEntire: 'Process entire subplot',
                purgeAll: 'Purge all pulse',
                cancel: 'Cancel',
                stats: '{{flagged}} flagged • {{processable}} processable • {{total}} total',
                infoLocalLlm: 'Local LLM mode: Valid results update scene hover fields automatically. Invalid results are logged and marked for review.',
                infoCloud: 'Your manuscript will be sent to the AI for pulse analysis of the selected scenes.',
                infoLine: 'Process pulse using {{model}} for the subplot "{{name}}".',
                noOptions: 'No subplot options available.',
                unknownSelection: 'Unknown subplot selection: {{name}}',
            },
            errorPrefix: 'Error: {{error}}',
            aiDisabledLabel: 'AI disabled',
        },
        aiProvider: {
            callError: 'Error calling {{provider}} API:\n{{detail}}',
            genericError: 'Error calling {{provider}} AI provider.',
        },
        commands: {
            runtimeEstimator: 'Runtime estimator',
        },
        runtime: {
            notices: {
                noScenesToProcess: 'No scenes to process.',
                aiAnalyzing: 'AI analyzing: {{title}}',
                completeWithErrors: '{{mode}} estimation complete. {{processed}} scenes updated, {{errors}} errors.',
                completeSuccess: '{{mode}} estimation complete! {{processed}} scenes updated. Total: {{total}}',
            },
        },
    },
};
