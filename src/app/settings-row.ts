import { html } from './format';
import { icon, type IconName } from './icons';

// The one header every Settings card uses, whichever feature renders the card. A card is
// recognised by its icon before its title is read, and the icon travels with the header when
// an open card pins it to the top of the page, so a long body never loses its name.
//
// Settings cards are one exclusive accordion: opening a card closes the one that was open.
// Two long bodies open at once is how a reader ends up inside a section they cannot name.
export const SETTINGS_ACCORDION = 'settings-card';

export interface SettingsSummary {
  icon: IconName;
  title: string;
  detail: string;
  pill?: { label: string; ok: boolean };
}

export function settingsIcon(name: IconName): string {
  return `<span class="settings-category-icon" aria-hidden="true">${icon(name)}</span>`;
}

export function settingsSummary(summary: SettingsSummary): string {
  const pill = summary.pill
    ? `<span class="status-pill ${summary.pill.ok ? 'ok' : ''}">${html(summary.pill.label)}</span>`
    : '';
  return `<summary>${settingsIcon(summary.icon)}<span class="settings-category-copy"><strong>${html(summary.title)}</strong><small>${html(summary.detail)}</small></span>${pill}<span class="settings-category-chevron" aria-hidden="true">${icon('chevron-down')}</span></summary>`;
}

// A labelled row with its control on the right: the shape of every action inside a card, so
// a download reads as a button next to what it downloads rather than as a line of text.
export function settingsRow(title: string, detail: string, control: string, extraClass = ''): string {
  return `<div class="settings-row${extraClass ? ` ${extraClass}` : ''}"><span class="settings-row-copy"><strong>${html(title)}</strong><small>${html(detail)}</small></span><span class="settings-row-control">${control}</span></div>`;
}

export function settingsButton(id: string, label: string, iconName: IconName, variant = ''): string {
  return `<button id="${id}" class="button small settings-row-button${variant ? ` ${variant}` : ''}" type="button">${icon(iconName)}<span>${html(label)}</span></button>`;
}
