import "@material/mwc-button/mwc-button";
import "@material/mwc-list/mwc-list";
import "@material/mwc-list/mwc-list-item";
import { mdiArrowUpRight, mdiPlay, mdiPlus } from "@mdi/js";
import "@polymer/paper-tooltip/paper-tooltip";
import {
  css,
  CSSResultGroup,
  html,
  LitElement,
  PropertyValues,
  TemplateResult,
} from "lit";
import {
  customElement,
  eventOptions,
  property,
  query,
  queryAll,
  state,
} from "lit/decorators";
import { classMap } from "lit/directives/class-map";
import { ifDefined } from "lit/directives/if-defined";
import { styleMap } from "lit/directives/style-map";
import { fireEvent } from "../../common/dom/fire_event";
import { computeRTLDirection } from "../../common/util/compute_rtl";
import { debounce } from "../../common/util/debounce";
import { getSignedPath } from "../../data/auth";
import type { MediaPlayerItem } from "../../data/media-player";
import {
  browseMediaPlayer,
  BROWSER_PLAYER,
  MediaClassBrowserSettings,
  MediaPickedEvent,
  MediaPlayerBrowseAction,
} from "../../data/media-player";
import { showAlertDialog } from "../../dialogs/generic/show-dialog-box";
import { installResizeObserver } from "../../panels/lovelace/common/install-resize-observer";
import { haStyle } from "../../resources/styles";
import type { HomeAssistant } from "../../types";
import { documentationUrl } from "../../util/documentation-url";
import "../entity/ha-entity-picker";
import "../ha-button-menu";
import "../ha-card";
import type { HaCard } from "../ha-card";
import "../ha-circular-progress";
import "../ha-icon-button";
import "../ha-svg-icon";
import "../ha-fab";
import { browseLocalMediaPlayer } from "../../data/media_source";
import { isTTSMediaSource } from "../../data/tts";
import { TtsMediaPickedEvent } from "./ha-browse-media-tts";

declare global {
  interface HASSDomEvents {
    "media-picked": MediaPickedEvent;
    "media-browsed": {
      // Items of the new browse stack
      ids: MediaPlayerItemId[];
      // Current fetched item for this browse stack
      current?: MediaPlayerItem;
      // If the new stack should replace the old stack
      replace?: boolean;
    };
  }
}

export interface MediaPlayerItemId {
  media_content_id: string | undefined;
  media_content_type: string | undefined;
}

@customElement("ha-media-player-browse")
export class HaMediaPlayerBrowse extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property() public entityId!: string;

  @property() public action: MediaPlayerBrowseAction = "play";

  @property({ type: Boolean }) public dialog = false;

  @property() public navigateIds!: MediaPlayerItemId[];

  @property({ type: Boolean, attribute: "narrow", reflect: true })
  // @ts-ignore
  private _narrow = false;

  @property({ type: Boolean, attribute: "scroll", reflect: true })
  private _scrolled = false;

  @state() private _error?: { message: string; code: string };

  @state() private _parentItem?: MediaPlayerItem;

  @state() private _currentItem?: MediaPlayerItem;

  @query(".header") private _header?: HTMLDivElement;

  @query(".content") private _content?: HTMLDivElement;

  @queryAll(".lazythumbnail") private _thumbnails?: HaCard[];

  private _headerOffsetHeight = 0;

  private _resizeObserver?: ResizeObserver;

  // @ts-ignore
  private _intersectionObserver?: IntersectionObserver;

  public connectedCallback(): void {
    super.connectedCallback();
    this.updateComplete.then(() => this._attachResizeObserver());
  }

  public disconnectedCallback(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
    }
  }

  public async refresh() {
    const currentId = this.navigateIds[this.navigateIds.length - 1];
    try {
      this._currentItem = await this._fetchData(
        this.entityId,
        currentId.media_content_id,
        currentId.media_content_type
      );
    } catch (err) {
      this._setError(err);
    }
  }

  public play(): void {
    if (this._currentItem?.can_play) {
      this._runAction(this._currentItem);
    }
  }

  protected render(): TemplateResult {
    if (this._error) {
      return html`
        <div class="container">${this._renderError(this._error)}</div>
      `;
    }

    if (!this._currentItem) {
      return html`<ha-circular-progress active></ha-circular-progress>`;
    }

    const currentItem = this._currentItem;

    const subtitle = this.hass.localize(
      `ui.components.media-browser.class.${currentItem.media_class}`
    );

    const mediaClass = MediaClassBrowserSettings[currentItem.media_class];
    const childrenMediaClass =
      MediaClassBrowserSettings[currentItem.children_media_class];

    return html`
              ${
                currentItem.can_play
                  ? html` <div
                      class="header ${classMap({
                        "no-img": !currentItem.thumbnail,
                        "no-dialog": !this.dialog,
                      })}"
                      @transitionend=${this._setHeaderHeight}
                    >
                      <div class="header-content">
                        ${currentItem.thumbnail
                          ? html`
                              <div
                                class="img"
                                style=${styleMap({
                                  backgroundImage: currentItem.thumbnail
                                    ? `url(${currentItem.thumbnail})`
                                    : "none",
                                })}
                              >
                                ${this._narrow && currentItem?.can_play
                                  ? html`
                                      <ha-fab
                                        mini
                                        .item=${currentItem}
                                        @click=${this._actionClicked}
                                      >
                                        <ha-svg-icon
                                          slot="icon"
                                          .label=${this.hass.localize(
                                            `ui.components.media-browser.${this.action}-media`
                                          )}
                                          .path=${this.action === "play"
                                            ? mdiPlay
                                            : mdiPlus}
                                        ></ha-svg-icon>
                                        ${this.hass.localize(
                                          `ui.components.media-browser.${this.action}`
                                        )}
                                      </ha-fab>
                                    `
                                  : ""}
                              </div>
                            `
                          : html``}
                        <div class="header-info">
                          <div class="breadcrumb">
                            <h1 class="title">${currentItem.title}</h1>
                            ${subtitle
                              ? html` <h2 class="subtitle">${subtitle}</h2> `
                              : ""}
                          </div>
                          ${currentItem.can_play &&
                          (!currentItem.thumbnail || !this._narrow)
                            ? html`
                                <mwc-button
                                  raised
                                  .item=${currentItem}
                                  @click=${this._actionClicked}
                                >
                                  <ha-svg-icon
                                    .label=${this.hass.localize(
                                      `ui.components.media-browser.${this.action}-media`
                                    )}
                                    .path=${this.action === "play"
                                      ? mdiPlay
                                      : mdiPlus}
                                  ></ha-svg-icon>
                                  ${this.hass.localize(
                                    `ui.components.media-browser.${this.action}`
                                  )}
                                </mwc-button>
                              `
                            : ""}
                        </div>
                      </div>
                    </div>`
                  : ""
              }
          <div
            class="content"
            @scroll=${this._scroll}
            @touchmove=${this._scroll}
          >
            ${
              this._error
                ? html`
                    <div class="container">
                      ${this._renderError(this._error)}
                    </div>
                  `
                : isTTSMediaSource(currentItem.media_content_id)
                ? html`
                    <ha-browse-media-tts
                      .item=${currentItem}
                      .hass=${this.hass}
                      .action=${this.action}
                      @tts-picked=${this._ttsPicked}
                    ></ha-browse-media-tts>
                  `
                : !currentItem.children?.length
                ? html`
                    <div class="container no-items">
                      ${currentItem.media_content_id ===
                      "media-source://media_source/local/."
                        ? html`
                            <div class="highlight-add-button">
                              <span>
                                <ha-svg-icon
                                  .path=${mdiArrowUpRight}
                                ></ha-svg-icon>
                              </span>
                              <span>
                                ${this.hass.localize(
                                  "ui.components.media-browser.file_management.highlight_button"
                                )}
                              </span>
                            </div>
                          `
                        : this.hass.localize(
                            "ui.components.media-browser.no_items"
                          )}
                    </div>
                  `
                : childrenMediaClass.layout === "grid"
                ? html`
                    <div
                      class="children ${classMap({
                        portrait:
                          childrenMediaClass.thumbnail_ratio === "portrait",
                      })}"
                    >
                      ${currentItem.children.map(
                        (child) => html`
                          <div
                            class="child"
                            .item=${child}
                            @click=${this._childClicked}
                          >
                            <ha-card outlined>
                              <div class="thumbnail">
                                ${child.thumbnail
                                  ? html`
                                      <div
                                        class="${["app", "directory"].includes(
                                          child.media_class
                                        )
                                          ? "centered-image"
                                          : ""} image lazythumbnail"
                                        data-src=${child.thumbnail}
                                      ></div>
                                    `
                                  : html`
                                      <div class="icon-holder image">
                                        <ha-svg-icon
                                          class="folder"
                                          .path=${MediaClassBrowserSettings[
                                            child.media_class === "directory"
                                              ? child.children_media_class ||
                                                child.media_class
                                              : child.media_class
                                          ].icon}
                                        ></ha-svg-icon>
                                      </div>
                                    `}
                                ${child.can_play
                                  ? html`
                                      <ha-icon-button
                                        class="play ${classMap({
                                          can_expand: child.can_expand,
                                        })}"
                                        .item=${child}
                                        .label=${this.hass.localize(
                                          `ui.components.media-browser.${this.action}-media`
                                        )}
                                        .path=${this.action === "play"
                                          ? mdiPlay
                                          : mdiPlus}
                                        @click=${this._actionClicked}
                                      ></ha-icon-button>
                                    `
                                  : ""}
                              </div>
                              <div class="title">
                                ${child.title}
                                <paper-tooltip
                                  fitToVisibleBounds
                                  position="top"
                                  offset="4"
                                  >${child.title}</paper-tooltip
                                >
                              </div>
                            </ha-card>
                          </div>
                        `
                      )}
                    </div>
                  `
                : html`
                    <mwc-list>
                      ${currentItem.children.map(
                        (child) => html`
                          <mwc-list-item
                            @click=${this._childClicked}
                            .item=${child}
                            .graphic=${mediaClass.show_list_images
                              ? "medium"
                              : "avatar"}
                            dir=${computeRTLDirection(this.hass)}
                          >
                            <div
                              class=${classMap({
                                graphic: true,
                                lazythumbnail:
                                  mediaClass.show_list_images === true,
                              })}
                              data-src=${ifDefined(
                                mediaClass.show_list_images && child.thumbnail
                                  ? child.thumbnail
                                  : undefined
                              )}
                              slot="graphic"
                            >
                              <ha-icon-button
                                class="play ${classMap({
                                  show:
                                    !mediaClass.show_list_images ||
                                    !child.thumbnail,
                                })}"
                                .item=${child}
                                .label=${this.hass.localize(
                                  `ui.components.media-browser.${this.action}-media`
                                )}
                                .path=${this.action === "play"
                                  ? mdiPlay
                                  : mdiPlus}
                                @click=${this._actionClicked}
                              ></ha-icon-button>
                            </div>
                            <span class="title">${child.title}</span>
                          </mwc-list-item>
                          <li divider role="separator"></li>
                        `
                      )}
                    </mwc-list>
                  `
            }
          </div>
        </div>
      </div>
    `;
  }

  protected firstUpdated(): void {
    this._measureCard();
    this._attachResizeObserver();
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (changedProps.size > 1 || !changedProps.has("hass")) {
      return true;
    }
    const oldHass = changedProps.get("hass") as this["hass"];
    return oldHass === undefined || oldHass.localize !== this.hass.localize;
  }

  public willUpdate(changedProps: PropertyValues<this>): void {
    super.willUpdate(changedProps);

    if (changedProps.has("entityId")) {
      this._setError(undefined);
    } else if (!changedProps.has("navigateIds")) {
      // Neither entity ID or navigateIDs changed, nothing to fetch
      return;
    }

    this._setError(undefined);

    const oldNavigateIds = changedProps.get("navigateIds") as
      | this["navigateIds"]
      | undefined;
    const navigateIds = this.navigateIds;

    // We're navigating. Reset the shizzle.
    this._content?.scrollTo(0, 0);
    this._scrolled = false;
    const oldCurrentItem = this._currentItem;
    const oldParentItem = this._parentItem;
    this._currentItem = undefined;
    this._parentItem = undefined;
    const currentId = navigateIds[navigateIds.length - 1];
    const parentId =
      navigateIds.length > 1 ? navigateIds[navigateIds.length - 2] : undefined;
    let currentProm: Promise<MediaPlayerItem> | undefined;
    let parentProm: Promise<MediaPlayerItem> | undefined;

    // See if we can take loading shortcuts if navigating to parent or child
    if (!changedProps.has("entityId")) {
      if (
        // Check if we navigated to a child
        oldNavigateIds &&
        navigateIds.length === oldNavigateIds.length + 1 &&
        oldNavigateIds.every((oldVal, idx) => {
          const curVal = navigateIds[idx];
          return (
            curVal.media_content_id === oldVal.media_content_id &&
            curVal.media_content_type === oldVal.media_content_type
          );
        })
      ) {
        parentProm = Promise.resolve(oldCurrentItem!);
      } else if (
        // Check if we navigated to a parent
        oldNavigateIds &&
        navigateIds.length === oldNavigateIds.length - 1 &&
        navigateIds.every((curVal, idx) => {
          const oldVal = oldNavigateIds[idx];
          return (
            curVal.media_content_id === oldVal.media_content_id &&
            curVal.media_content_type === oldVal.media_content_type
          );
        })
      ) {
        currentProm = Promise.resolve(oldParentItem!);
      }
    }
    // Fetch current
    if (!currentProm) {
      currentProm = this._fetchData(
        this.entityId,
        currentId.media_content_id,
        currentId.media_content_type
      );
    }
    currentProm.then(
      (item) => {
        this._currentItem = item;
        fireEvent(this, "media-browsed", {
          ids: navigateIds,
          current: item,
        });
      },
      (err) => {
        // When we change entity ID, we will first try to see if the new entity is
        // able to resolve the new path. If that results in an error, browse the root.
        const isNewEntityWithSamePath =
          oldNavigateIds &&
          changedProps.has("entityId") &&
          navigateIds.length === oldNavigateIds.length &&
          oldNavigateIds.every(
            (oldItem, idx) =>
              navigateIds[idx].media_content_id === oldItem.media_content_id &&
              navigateIds[idx].media_content_type === oldItem.media_content_type
          );
        if (isNewEntityWithSamePath) {
          fireEvent(this, "media-browsed", {
            ids: [
              { media_content_id: undefined, media_content_type: undefined },
            ],
            replace: true,
          });
        } else {
          this._setError(err);
        }
      }
    );
    // Fetch parent
    if (!parentProm && parentId !== undefined) {
      parentProm = this._fetchData(
        this.entityId,
        parentId.media_content_id,
        parentId.media_content_type
      );
    }
    if (parentProm) {
      parentProm.then((parent) => {
        this._parentItem = parent;
      });
    }
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);

    if (changedProps.has("_scrolled")) {
      this._animateHeaderHeight();
    } else if (changedProps.has("_currentItem")) {
      this._setHeaderHeight();
      this._attachIntersectionObserver();
    }
  }

  private _actionClicked(ev: MouseEvent): void {
    ev.stopPropagation();
    const item = (ev.currentTarget as any).item;

    this._runAction(item);
  }

  private _runAction(item: MediaPlayerItem): void {
    fireEvent(this, "media-picked", { item, navigateIds: this.navigateIds });
  }

  private _ttsPicked(ev: CustomEvent<TtsMediaPickedEvent>): void {
    ev.stopPropagation();
    const navigateIds = this.navigateIds.slice(0, -1);
    navigateIds.push(ev.detail.item);
    fireEvent(this, "media-picked", {
      ...ev.detail,
      navigateIds,
    });
  }

  private async _childClicked(ev: MouseEvent): Promise<void> {
    const target = ev.currentTarget as any;
    const item: MediaPlayerItem = target.item;

    if (!item) {
      return;
    }

    if (!item.can_expand) {
      this._runAction(item);
      return;
    }

    fireEvent(this, "media-browsed", {
      ids: [...this.navigateIds, item],
    });
  }

  private async _fetchData(
    entityId: string,
    mediaContentId?: string,
    mediaContentType?: string
  ): Promise<MediaPlayerItem> {
    return entityId !== BROWSER_PLAYER
      ? browseMediaPlayer(this.hass, entityId, mediaContentId, mediaContentType)
      : browseLocalMediaPlayer(this.hass, mediaContentId);
  }

  private _measureCard(): void {
    this._narrow = (this.dialog ? window.innerWidth : this.offsetWidth) < 450;
  }

  private async _attachResizeObserver(): Promise<void> {
    if (!this._resizeObserver) {
      await installResizeObserver();
      this._resizeObserver = new ResizeObserver(
        debounce(() => this._measureCard(), 250, false)
      );
    }

    this._resizeObserver.observe(this);
  }

  /**
   * Load thumbnails for images on demand as they become visible.
   */
  private async _attachIntersectionObserver(): Promise<void> {
    if (!("IntersectionObserver" in window) || !this._thumbnails) {
      return;
    }
    if (!this._intersectionObserver) {
      this._intersectionObserver = new IntersectionObserver(
        async (entries, observer) => {
          await Promise.all(
            entries.map(async (entry) => {
              if (!entry.isIntersecting) {
                return;
              }
              const thumbnailCard = entry.target as HTMLElement;
              let thumbnailUrl = thumbnailCard.dataset.src;
              if (!thumbnailUrl) {
                return;
              }
              if (thumbnailUrl.startsWith("/")) {
                // Thumbnails served by local API require authentication
                const signedPath = await getSignedPath(this.hass, thumbnailUrl);
                thumbnailUrl = signedPath.path;
              }
              thumbnailCard.style.backgroundImage = `url(${thumbnailUrl})`;
              observer.unobserve(thumbnailCard); // loaded, so no need to observe anymore
            })
          );
        }
      );
    }
    const observer = this._intersectionObserver!;
    for (const thumbnailCard of this._thumbnails) {
      observer.observe(thumbnailCard);
    }
  }

  private _closeDialogAction(): void {
    fireEvent(this, "close-dialog");
  }

  private _setError(error: any) {
    if (!this.dialog) {
      this._error = error;
      return;
    }

    if (!error) {
      return;
    }

    this._closeDialogAction();
    showAlertDialog(this, {
      title: this.hass.localize(
        "ui.components.media-browser.media_browsing_error"
      ),
      text: this._renderError(error),
    });
  }

  private _renderError(err: { message: string; code: string }) {
    if (err.message === "Media directory does not exist.") {
      return html`
        <h2>
          ${this.hass.localize(
            "ui.components.media-browser.no_local_media_found"
          )}
        </h2>
        <p>
          ${this.hass.localize("ui.components.media-browser.no_media_folder")}
          <br />
          ${this.hass.localize(
            "ui.components.media-browser.setup_local_help",
            "documentation",
            html`<a
              href=${documentationUrl(
                this.hass,
                "/more-info/local-media/setup-media"
              )}
              target="_blank"
              rel="noreferrer"
              >${this.hass.localize(
                "ui.components.media-browser.documentation"
              )}</a
            >`
          )}
          <br />
          ${this.hass.localize("ui.components.media-browser.local_media_files")}
        </p>
      `;
    }
    return html`<span class="error">${err.message}</span>`;
  }

  private async _setHeaderHeight() {
    await this.updateComplete;
    const header = this._header;
    const content = this._content;
    if (!header || !content) {
      return;
    }
    this._headerOffsetHeight = header.offsetHeight;
    content.style.marginTop = `${this._headerOffsetHeight}px`;
    content.style.maxHeight = `calc(var(--media-browser-max-height, 100%) - ${this._headerOffsetHeight}px)`;
  }

  private _animateHeaderHeight() {
    let start;
    const animate = (time) => {
      if (start === undefined) {
        start = time;
      }
      const elapsed = time - start;
      this._setHeaderHeight();
      if (elapsed < 400) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  @eventOptions({ passive: true })
  private _scroll(ev: Event): void {
    const content = ev.currentTarget as HTMLDivElement;
    if (!this._scrolled && content.scrollTop > this._headerOffsetHeight) {
      this._scrolled = true;
    } else if (this._scrolled && content.scrollTop < this._headerOffsetHeight) {
      this._scrolled = false;
    }
  }

  static get styles(): CSSResultGroup {
    return [
      haStyle,
      css`
        :host {
          display: flex;
          flex-direction: column;
          position: relative;
        }

        ha-circular-progress {
          --mdc-theme-primary: var(--primary-color);
          display: flex;
          justify-content: center;
          margin: 40px;
        }

        .container {
          padding: 16px;
        }

        .no-items {
          padding-left: 32px;
        }

        .highlight-add-button {
          display: flex;
          flex-direction: row-reverse;
          margin-right: 48px;
        }

        .highlight-add-button ha-svg-icon {
          position: relative;
          top: -0.5em;
          margin-left: 8px;
        }

        .content {
          overflow-y: auto;
          box-sizing: border-box;
        }

        /* HEADER */

        .header {
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid var(--divider-color);
          background-color: var(--card-background-color);
          position: absolute;
          top: 0;
          right: 0;
          left: 0;
          z-index: 5;
          padding: 16px;
        }
        .header_button {
          position: relative;
          right: -8px;
        }
        .header-content {
          display: flex;
          flex-wrap: wrap;
          flex-grow: 1;
          align-items: flex-start;
        }
        .header-content .img {
          height: 175px;
          width: 175px;
          margin-right: 16px;
          background-size: cover;
          border-radius: 2px;
          transition: width 0.4s, height 0.4s;
        }
        .header-info {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-self: stretch;
          min-width: 0;
          flex: 1;
        }
        .header-info mwc-button {
          display: block;
          --mdc-theme-primary: var(--primary-color);
          padding-bottom: 16px;
        }
        .breadcrumb {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          flex-grow: 1;
          padding-top: 16px;
        }
        .breadcrumb .title {
          font-size: 32px;
          line-height: 1.2;
          font-weight: bold;
          margin: 0;
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          padding-right: 8px;
        }
        .breadcrumb .previous-title {
          font-size: 14px;
          padding-bottom: 8px;
          color: var(--secondary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          cursor: pointer;
          --mdc-icon-size: 14px;
        }
        .breadcrumb .subtitle {
          font-size: 16px;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 0;
          transition: height 0.5s, margin 0.5s;
        }

        /* ============= CHILDREN ============= */

        mwc-list {
          --mdc-list-vertical-padding: 0;
          --mdc-list-item-graphic-margin: 0;
          --mdc-theme-text-icon-on-background: var(--secondary-text-color);
          margin-top: 10px;
        }

        mwc-list li:last-child {
          display: none;
        }

        mwc-list li[divider] {
          border-bottom-color: var(--divider-color);
        }

        .children {
          display: grid;
          grid-template-columns: repeat(
            auto-fit,
            minmax(var(--media-browse-item-size, 175px), 0.1fr)
          );
          grid-gap: 16px;
          padding: 16px;
        }

        :host([dialog]) .children {
          grid-template-columns: repeat(
            auto-fit,
            minmax(var(--media-browse-item-size, 175px), 0.33fr)
          );
        }

        .child {
          display: flex;
          flex-direction: column;
          cursor: pointer;
        }

        ha-card {
          position: relative;
          width: 100%;
          box-sizing: border-box;
        }

        .children ha-card .thumbnail {
          width: 100%;
          position: relative;
          box-sizing: border-box;
          transition: padding-bottom 0.1s ease-out;
          padding-bottom: 100%;
        }

        .portrait.children ha-card .thumbnail {
          padding-bottom: 150%;
        }

        ha-card .image {
          border-radius: 3px 3px 0 0;
        }

        .image {
          position: absolute;
          top: 0;
          right: 0;
          left: 0;
          bottom: 0;
          background-size: cover;
          background-repeat: no-repeat;
          background-position: center;
        }

        .centered-image {
          margin: 0 8px;
          background-size: contain;
        }

        .children ha-card .icon-holder {
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .child .folder {
          color: var(--secondary-text-color);
          --mdc-icon-size: calc(var(--media-browse-item-size, 175px) * 0.4);
        }

        .child .play {
          position: absolute;
          transition: color 0.5s;
          border-radius: 50%;
          top: calc(50% - 50px);
          right: calc(50% - 35px);
          opacity: 0;
          transition: opacity 0.1s ease-out;
        }

        .child .play:not(.can_expand) {
          --mdc-icon-button-size: 70px;
          --mdc-icon-size: 48px;
        }

        ha-card:hover .play {
          opacity: 1;
        }

        ha-card:hover .play:not(.can_expand) {
          color: var(--primary-color);
        }

        ha-card:hover .play.can_expand {
          bottom: 8px;
        }

        .child .play.can_expand {
          background-color: rgba(var(--rgb-card-background-color), 0.5);
          top: auto;
          bottom: 0px;
          right: 8px;
          transition: bottom 0.1s ease-out, opacity 0.1s ease-out;
        }

        .child .play:hover {
          color: var(--primary-color);
        }

        ha-card:hover .lazythumbnail {
          opacity: 0.5;
        }

        .child .title {
          font-size: 16px;
          padding-top: 16px;
          padding-left: 2px;
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          text-overflow: ellipsis;
        }

        .child ha-card .title {
          margin-bottom: 16px;
          padding-left: 16px;
        }

        mwc-list-item .graphic {
          background-size: contain;
          border-radius: 2px;
          display: flex;
          align-content: center;
          align-items: center;
          line-height: initial;
        }

        mwc-list-item .graphic .play {
          opacity: 0;
          transition: all 0.5s;
          background-color: rgba(var(--rgb-card-background-color), 0.5);
          border-radius: 50%;
          --mdc-icon-button-size: 40px;
        }

        mwc-list-item:hover .graphic .play {
          opacity: 1;
          color: var(--primary-text-color);
        }

        mwc-list-item .graphic .play.show {
          opacity: 1;
          background-color: transparent;
        }

        mwc-list-item .title {
          margin-left: 16px;
        }
        mwc-list-item[dir="rtl"] .title {
          margin-right: 16px;
          margin-left: 0;
        }

        /* ============= Narrow ============= */

        :host([narrow]) {
          padding: 0;
        }

        :host([narrow]) .media-source {
          padding: 0 24px;
        }

        :host([narrow]) .children {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
        }

        :host([narrow]) .breadcrumb .title {
          font-size: 24px;
        }
        :host([narrow]) .header {
          padding: 0;
        }
        :host([narrow]) .header.no-dialog {
          display: block;
        }
        :host([narrow]) .header_button {
          position: absolute;
          top: 14px;
          right: 8px;
        }
        :host([narrow]) .header-content {
          flex-direction: column;
          flex-wrap: nowrap;
        }
        :host([narrow]) .header-content .img {
          height: auto;
          width: 100%;
          margin-right: 0;
          padding-bottom: 50%;
          margin-bottom: 8px;
          position: relative;
          background-position: center;
          border-radius: 0;
          transition: width 0.4s, height 0.4s, padding-bottom 0.4s;
        }
        ha-fab {
          position: absolute;
          --mdc-theme-secondary: var(--primary-color);
          bottom: -20px;
          right: 20px;
        }
        :host([narrow]) .header-info mwc-button {
          margin-top: 16px;
          margin-bottom: 8px;
        }
        :host([narrow]) .header-info {
          padding: 0 16px 8px;
        }

        /* ============= Scroll ============= */
        :host([scroll]) .breadcrumb .subtitle {
          height: 0;
          margin: 0;
        }
        :host([scroll]) .breadcrumb .title {
          -webkit-line-clamp: 1;
        }
        :host(:not([narrow])[scroll]) .header:not(.no-img) ha-icon-button {
          align-self: center;
        }
        :host([scroll]) .header-info mwc-button,
        .no-img .header-info mwc-button {
          padding-right: 4px;
        }
        :host([scroll][narrow]) .no-img .header-info mwc-button {
          padding-right: 16px;
        }
        :host([scroll]) .header-info {
          flex-direction: row;
        }
        :host([scroll]) .header-info mwc-button {
          align-self: center;
          margin-top: 0;
          margin-bottom: 0;
          padding-bottom: 0;
        }
        :host([scroll][narrow]) .no-img .header-info {
          flex-direction: row-reverse;
        }
        :host([scroll][narrow]) .header-info {
          padding: 20px 24px 10px 24px;
          align-items: center;
        }
        :host([scroll]) .header-content {
          align-items: flex-end;
          flex-direction: row;
        }
        :host([scroll]) .header-content .img {
          height: 75px;
          width: 75px;
        }
        :host([scroll]) .breadcrumb {
          padding-top: 0;
          align-self: center;
        }
        :host([scroll][narrow]) .header-content .img {
          height: 100px;
          width: 100px;
          padding-bottom: initial;
          margin-bottom: 0;
        }
        :host([scroll]) ha-fab {
          bottom: 0px;
          right: -24px;
          --mdc-fab-box-shadow: none;
          --mdc-theme-secondary: rgba(var(--rgb-primary-color), 0.5);
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-media-player-browse": HaMediaPlayerBrowse;
  }
}
