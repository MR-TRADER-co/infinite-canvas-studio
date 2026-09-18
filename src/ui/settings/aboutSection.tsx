"use client";

/**
 * The About settings section (v1.48.5): the app's identity surface —
 * version, author, licence and THE sanctioned GitHub hand-off. A user
 * who hits a problem (or wants the latest release) opens Settings →
 * «درباره» and follows the repository link, which goes through the
 * app's R3B.3 flow: `requestOpenLinkConfirmation` → the Persian
 * confirmation naming the URL → the OS default browser (the app
 * itself never makes network calls).
 *
 * Registered additively by registerSettings (order 60, after Storage);
 * the dialog composes it with zero dialog-code edits (AC8.3).
 */
import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/ui/i18n";
import { requestOpenLinkConfirmation } from "@/ui/text/intents";
import { APP_GITHUB_URL } from "@/ui/settings/about";
import { Row, SectionHeader } from "@/ui/settings/sections";

/** The About section body (identity + the GitHub hand-off). */
export function AboutSettingsSection(): ReactElement {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader title={t("settings.section.about")} />
      <Row title={t("settings.about.version")}>
        <p className="text-xs text-muted-foreground tabular-nums">
          {t("status.version")}
        </p>
      </Row>
      <Row title={t("settings.about.author")}>
        <p className="text-xs text-muted-foreground">
          {t("settings.about.authorValue")}
        </p>
      </Row>
      <Row title={t("settings.about.license")}>
        <p className="text-xs text-muted-foreground">
          {t("settings.about.licenseValue")}
        </p>
      </Row>
      <Row
        title={t("settings.about.github")}
        hint={t("settings.about.githubHint")}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => requestOpenLinkConfirmation(APP_GITHUB_URL)}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          {t("settings.about.open")}
        </Button>
      </Row>
    </div>
  );
}
