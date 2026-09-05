/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Toolchain scan — finds Pandoc and LaTeX on this machine.
 *
 * Phase 1 probes well-known install locations directly (Electron's PATH is
 * empty, so `which` alone misses most installs). Phase 2 falls back to
 * `which`/`where` with an enriched PATH. Nothing here touches the vault or
 * plugin settings; callers decide what to do with the result.
 */

import { accessSync, constants as fsConstants } from 'fs'; // SAFE: Node fs executable probe for known install paths outside the vault
import { execFile } from 'child_process'; // SAFE: Node child_process for system path scanning
import * as os from 'os'; // SAFE: Node os for home-directory resolution (no env identity reads)
import * as path from 'path'; // SAFE: Node path for absolute-path detection
import { Platform } from 'obsidian';
import { buildMinimalSubprocessEnv } from '../utils/exportFormats';

export interface ToolchainScanResult {
    pandocPath: string | null;
    latexPath: string | null;
    latexEngine: string | null;
}

export interface LatexEngineCandidate {
    engine: string;
    path: string;
}

function isExecutableFile(absPath: string): boolean {
    try {
        accessSync(absPath, fsConstants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function isAbsoluteLike(candidate: string): boolean {
    return path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate);
}

/**
 * macOS: Homebrew (Apple Silicon + Intel), MacTeX.
 * Windows: default installer paths, Chocolatey, Scoop, MiKTeX, TeX Live.
 * Linux: package-manager locations, Snap, TeX Live.
 */
function getKnownPandocPaths(): string[] {
    if (Platform.isWin) {
        const userProfile = os.homedir();
        const localAppData = path.join(userProfile, 'AppData', 'Local');
        return [
            'C:\\Program Files\\Pandoc\\pandoc.exe',                       // Default installer
            'C:\\Program Files (x86)\\Pandoc\\pandoc.exe',                 // 32-bit installer
            `${localAppData}\\Pandoc\\pandoc.exe`,                         // User install
            'C:\\ProgramData\\chocolatey\\bin\\pandoc.exe',                // Chocolatey
            `${userProfile}\\scoop\\shims\\pandoc.exe`,                    // Scoop
            `${userProfile}\\scoop\\apps\\pandoc\\current\\pandoc.exe`,    // Scoop direct
        ];
    }
    return [
        '/opt/homebrew/bin/pandoc',                         // Homebrew Apple Silicon
        '/usr/local/bin/pandoc',                            // Homebrew Intel / manual install
        path.join(os.homedir(), '.local', 'bin', 'pandoc'), // Standalone binary / pipx (user-space)
        '/usr/bin/pandoc',                                  // System / package-manager install
        '/snap/bin/pandoc',                                 // Snap (Linux)
    ];
}

function getKnownLatexPaths(): { engine: string; paths: string[] }[] {
    if (Platform.isWin) {
        const localAppData = path.join(os.homedir(), 'AppData', 'Local');
        const miktexBins = [
            'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64',
            `${localAppData}\\Programs\\MiKTeX\\miktex\\bin\\x64`,
            'C:\\miktex\\miktex\\bin\\x64',
        ];
        const texliveBins: string[] = [];
        for (let year = new Date().getFullYear(); year >= 2020; year--) {
            texliveBins.push(`C:\\texlive\\${year}\\bin\\windows`);
            texliveBins.push(`C:\\texlive\\${year}\\bin\\win32`);
        }
        const allWinBins = [...miktexBins, ...texliveBins];
        return [
            { engine: 'xelatex',  paths: allWinBins.map(b => `${b}\\xelatex.exe`) },
            { engine: 'pdflatex', paths: allWinBins.map(b => `${b}\\pdflatex.exe`) },
            { engine: 'lualatex', paths: allWinBins.map(b => `${b}\\lualatex.exe`) },
        ];
    }
    return [
        { engine: 'xelatex',  paths: ['/Library/TeX/texbin/xelatex',  '/opt/homebrew/bin/xelatex',  '/usr/local/bin/xelatex',  '/usr/bin/xelatex']  },
        { engine: 'pdflatex', paths: ['/Library/TeX/texbin/pdflatex', '/opt/homebrew/bin/pdflatex', '/usr/local/bin/pdflatex', '/usr/bin/pdflatex'] },
        { engine: 'lualatex', paths: ['/Library/TeX/texbin/lualatex', '/opt/homebrew/bin/lualatex', '/usr/local/bin/lualatex', '/usr/bin/lualatex'] },
    ];
}

/** PATH for the `which`/`where` fallback: common binary folders for this platform ahead of the inherited PATH. */
function getEnrichedPath(): string {
    const existing = process.env.PATH || '';
    if (Platform.isWin) {
        const userProfile = os.homedir();
        const localAppData = path.join(userProfile, 'AppData', 'Local');
        const extra = [
            'C:\\Program Files\\Pandoc',
            'C:\\Program Files (x86)\\Pandoc',
            `${localAppData}\\Pandoc`,
            'C:\\ProgramData\\chocolatey\\bin',
            `${userProfile}\\scoop\\shims`,
            'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64',
            `${localAppData}\\Programs\\MiKTeX\\miktex\\bin\\x64`,
        ];
        for (let year = new Date().getFullYear(); year >= 2020; year--) {
            extra.push(`C:\\texlive\\${year}\\bin\\windows`);
        }
        return [...extra, existing].join(';');
    }
    return ['/opt/homebrew/bin', '/usr/local/bin', '/Library/TeX/texbin', '/usr/bin', '/snap/bin', existing].join(':');
}

function whichFirstLine(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
    const whichCmd = Platform.isWin ? 'where' : 'which';
    return new Promise(resolve => {
        execFile(whichCmd, [command], { timeout: 5000, env }, (error, stdout) => {
            const first = !error && stdout ? stdout.trim().split(/[\r\n]/)[0] : '';
            resolve(first || null);
        });
    });
}

export async function scanSystemPaths(): Promise<ToolchainScanResult> {
    const result: ToolchainScanResult = { pandocPath: null, latexPath: null, latexEngine: null };

    result.pandocPath = getKnownPandocPaths().find(isExecutableFile) ?? null;
    for (const { engine, paths } of getKnownLatexPaths()) {
        const found = paths.find(isExecutableFile);
        if (found) {
            result.latexPath = found;
            result.latexEngine = engine;
            break;
        }
    }

    if (result.pandocPath && result.latexPath) return result;

    const env = buildMinimalSubprocessEnv(getEnrichedPath());
    if (!result.pandocPath) {
        result.pandocPath = await whichFirstLine('pandoc', env);
    }
    if (!result.latexPath) {
        for (const engine of ['xelatex', 'pdflatex', 'lualatex']) {
            const found = await whichFirstLine(engine, env);
            if (found) {
                result.latexPath = found;
                result.latexEngine = engine;
                break;
            }
        }
    }
    return result;
}

/** Every LaTeX engine found at a known location, in engine preference order. */
export function listAvailableLatexEngines(): LatexEngineCandidate[] {
    const available: LatexEngineCandidate[] = [];
    for (const { engine, paths } of getKnownLatexPaths()) {
        const found = paths.find(isExecutableFile);
        if (found) available.push({ engine, path: found });
    }
    return available;
}

/**
 * Whether a configured Pandoc path can be used: an absolute path must be an
 * executable file; a bare command name (e.g. "pandoc") relies on PATH at run
 * time and is accepted; anything with separators that is not absolute is not.
 */
export function isPandocPathValid(configuredPath: string | undefined): boolean {
    const candidate = (configuredPath || '').trim();
    if (!candidate) return false;
    if (isAbsoluteLike(candidate)) return isExecutableFile(candidate);
    if (candidate.includes('/') || candidate.includes('\\')) return false;
    return true;
}
