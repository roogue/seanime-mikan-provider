/// <reference path="./types/anime-torrent-provider.d.ts" />
/// <reference path="./types/core.d.ts" />

class Provider {
  private api = "https://mikanani.me";
  private bangumiMikanMappingUrl =
    "https://raw.githubusercontent.com/xiaoyvyv/bangumi-data/main/data/mikan/bangumi-mikan.json";

  getSettings(): AnimeProviderSettings {
    return {
      canSmartSearch: true,
      smartSearchFilters: ["episodeNumber", "resolution"],
      supportsAdult: false,
      type: "main",
    };
  }

  async search(opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
    console.log("[Search] Initiating search for query:", opts.query);

    if (!opts.query) {
      console.log("[Search] Empty query, returning empty results.");
      return [];
    }

    const url = `${this.api}/RSS/Search?searchstr=${encodeURIComponent(opts.query)}`;
    console.log("[Search] Fetching RSS:", url);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(
          "[Search] Search fetch failed with status:",
          $toString(response.status),
        );
        return [];
      }

      const xmlText = response.text();
      const feed = $goFeed.parse(xmlText);
      const items = feed?.items || [];

      console.log("[Search] Found RSS items:", $toString(items.length));

      const results: AnimeTorrent[] = [];

      for (const item of items) {
        const title = $toString(item.title || "").trim();
        if (!title) continue;

        let size = 0;
        let downloadUrl = "";
        if (item.enclosures && item.enclosures.length > 0) {
          const len = parseInt($toString(item.enclosures[0].length || "0"), 10);
          if (!isNaN(len)) size = len;
          downloadUrl = $toString(item.enclosures[0].url || "").trim();
        }

        const torrent: AnimeTorrent = {
          name: title,
          date: $toString(
            item.published || item.pubDate || item.updated || "",
          ).trim(),
          size: size,
          formattedSize: "",
          seeders: 0,
          leechers: 0,
          downloadCount: 0,
          link: $toString(item.link || "").trim(),
          downloadUrl: downloadUrl,
          episodeNumber: -1, // Let Seanime parse the episode from the name
          isBestRelease: false,
          confirmed: false, // Not guaranteed to be an exact match since it's a loose string search
        };

        results.push(torrent);
      }

      return results;
    } catch (err) {
      console.log(
        "[Search] Error fetching/parsing search RSS:",
        $toString(err),
      );
      return [];
    }
  }

  async smartSearch(opts: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
    console.log(
      "[SmartSearch] Initiating smart search for:",
      opts.media.romajiTitle || opts.media.englishTitle,
    );

    const mikanId = await this.resolveMikanId(opts);
    if (!mikanId) {
      console.log(
        "[SmartSearch] Aborting search: Mikan ID could not be resolved.",
      );
      return [];
    }

    const prefSubgroupsStr = $getUserPreference("preferred_subgroups");
    if (prefSubgroupsStr) {
      const subgroups = prefSubgroupsStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const subgroupId of subgroups) {
        console.log("[SmartSearch] Searching preferred subgroup:", subgroupId);
        const rssItems = await this.fetchMikanRss(mikanId, subgroupId);
        if (rssItems && rssItems.length > 0) {
          const results = this.parseAndScoreTorrents(rssItems, opts);
          if (results.length > 0) {
            console.log(
              "[SmartSearch] Found matching episode in preferred subgroup:",
              subgroupId,
            );
            return results;
          }
          console.log(
            "[SmartSearch] Subgroup",
            subgroupId,
            "had RSS items but none matched the requested episode.",
          );
        }
      }
      console.log(
        "[SmartSearch] No preferred subgroup contained the target episode. Falling back to search all.",
      );
    }

    const allRssItems = await this.fetchMikanRss(mikanId);
    if (!allRssItems || allRssItems.length === 0) {
      console.log(
        "[SmartSearch] Aborting search: No RSS items found in global search.",
      );
      return [];
    }

    return this.parseAndScoreTorrents(allRssItems, opts);
  }

  async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> {
    return torrent.infoHash || "";
  }

  async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> {
    if (torrent.magnetLink) {
      return torrent.magnetLink;
    }

    const targetUrl = torrent.downloadUrl || torrent.link;
    if (!targetUrl) {
      console.log("[Magnet] No download URL provided.");
      return "";
    }

    console.log("[Magnet] Fetching torrent file from:", targetUrl);
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        console.log(
          "[Magnet] Failed to download torrent file. Status:",
          $toString(response.status),
        );
        return "";
      }

      const rawText = response.text();

      // Bypass Buffer completely. Use CryptoJS to safely encode the binary text to Base64
      const rawArray = CryptoJS.enc.Utf8.parse(rawText);
      const base64Content = CryptoJS.enc.Base64.stringify(rawArray);

      let magnet = "";
      try {
        // @ts-ignore - Bypassing strict TS checks
        magnet = $torrentUtils.getMagnetLinkFromTorrentData(base64Content);
      } catch (err) {
        console.log("[Magnet] $torrentUtils threw an error:", $toString(err));
      }

      if (magnet) {
        console.log("[Magnet] Successfully extracted magnet link via utility.");
        return magnet;
      }

      // Fallback for files with injected hashes
      console.log("[Magnet] Utility failed, attempting regex fallback...");
      return this.extractInjectedMagnet(base64Content, torrent.name);
    } catch (err) {
      console.log("[Magnet] Error in magnet link generation:", $toString(err));
      return "";
    }
  }

  // Fallback method to extract magnet link from specially formatted torrent files
  // Makin torrent are somehow injected with a 40-character hash in the binary data, so we can regex it out
  private extractInjectedMagnet(
    base64Data: string,
    torrentName: string,
  ): string {
    try {
      const binaryArray = CryptoJS.enc.Base64.parse(base64Data);
      const binaryString = CryptoJS.enc.Latin1.stringify(binaryArray);

      // Search for the 40-character hex hash
      const hashMatch = binaryString.match(/4:hash40:([a-f0-9]{40})/i);

      if (hashMatch && hashMatch[1]) {
        const infoHash = hashMatch[1];
        console.log(
          "[MagnetFallback] Successfully extracted injected hash:",
          infoHash,
        );

        const encodedName = encodeURIComponent(torrentName);
        return `magnet:?xt=urn:btih:${infoHash}&dn=${encodedName}`;
      }
    } catch (err) {
      console.log("[MagnetFallback] Regex extraction failed:", $toString(err));
    }

    console.log("[MagnetFallback] Could not find injected hash.");
    return "";
  }

  async getLatest(): Promise<AnimeTorrent[]> {
    return [];
  }

  private parseAndScoreTorrents(
    rssItems: any[],
    opts: AnimeSmartSearchOptions,
  ): AnimeTorrent[] {
    console.log("[SmartSearch] Parsing and scoring torrents.");
    const results: { torrent: AnimeTorrent; score: number }[] = [];

    for (const item of rssItems) {
      const title = $toString(item.title || "").trim();
      if (!title) continue;

      const meta = $habari.parse(title);
      let score = 0;
      let confirmed = false;

      // Episode Match (Trim, Strip Leading Zeros)
      let parsedEpisode = -1;
      if (meta.episode_number && meta.episode_number.length > 0) {
        const epStr = meta.episode_number[0].trim().replace(/^0+/, "");
        parsedEpisode = parseInt(epStr || "0", 10);
      }

      const reqEp = opts.episodeNumber;
      const absoluteOffset = opts.media.absoluteSeasonOffset || 0;
      const reqAbsEp = reqEp > 0 ? reqEp + absoluteOffset : -1;

      if (reqEp > 0) {
        if (parsedEpisode === reqEp || parsedEpisode === reqAbsEp) {
          score += 50;
          confirmed = true;
        } else if (parsedEpisode !== -1) {
          // Filter out torrents if they explicitly do not match the requested episode
          continue;
        }
      } else {
        confirmed = true;
      }

      // Resolution Match (Case Insensitive, Trimmed)
      const reqRes = opts.resolution
        ? opts.resolution.toLowerCase().trim()
        : "";
      const parsedRes = meta.video_resolution
        ? meta.video_resolution.toLowerCase().trim()
        : "";

      if (reqRes && parsedRes) {
        if (
          parsedRes === reqRes ||
          parsedRes.includes(reqRes) ||
          reqRes.includes(parsedRes)
        ) {
          score += 20;
        } else if (reqRes === "1080p" && parsedRes.includes("1920x1080")) {
          score += 20;
        }
      }

      // pubDate vs startDate Match
      const pubDateStr = $toString(
        item.published || item.pubDate || item.updated || "",
      ).trim();
      if (opts.media.startDate && opts.media.startDate.year && pubDateStr) {
        if (pubDateStr.includes($toString(opts.media.startDate.year))) {
          score += 10;
        }
      }

      // Standardize output mappings
      let size = 0;
      let torrentLink = "";
      if (item.enclosures && item.enclosures.length > 0) {
        const len = parseInt($toString(item.enclosures[0].length || "0"), 10);
        if (!isNaN(len)) size = len;
        torrentLink = $toString(item.enclosures[0].url || "").trim();
      }

      const torrent: AnimeTorrent = {
        name: title,
        date: pubDateStr,
        size: size,
        formattedSize: "",
        seeders: score, // Use seeders to store score for sorting later lol #Hackerman
        leechers: 0,
        downloadCount: 0,
        link: torrentLink,
        downloadUrl: torrentLink,
        resolution: meta.video_resolution || "",
        episodeNumber: parsedEpisode,
        releaseGroup: meta.release_group || "",
        isBestRelease: false,
        confirmed: confirmed,
      };

      results.push({ torrent, score });
    }

    // Sort Highest Score First
    results.sort((a, b) => b.score - a.score);

    // Assign Best Release tag
    if (results.length > 0) {
      results[0].torrent.isBestRelease = true;
    }

    console.log(
      "[SmartSearch] Successfully parsed and scored",
      $toString(results.length),
      "torrents.",
    );
    return results.map((r) => r.torrent);
  }

  private async fetchMikanRss(
    mikanId: string,
    subgroupId?: string,
  ): Promise<any[]> {
    let url = `${this.api}/RSS/Bangumi?bangumiId=${mikanId}`;
    if (subgroupId) {
      url += `&subgroupid=${subgroupId}`;
    }

    console.log("[SmartSearch] Fetching RSS:", url);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(
          "[SmartSearch] RSS fetch failed with status:",
          $toString(response.status),
        );
        return [];
      }
      const xmlText = response.text();
      const feed = $goFeed.parse(xmlText);
      return feed?.items || [];
    } catch (err) {
      console.log("[SmartSearch] Error fetching/parsing RSS:", $toString(err));
      return [];
    }
  }

  private async getBangumiId(title: string): Promise<string | null> {
    console.log("[SmartSearch] Searching Bangumi for title:", title);
    const url = `https://api.bgm.tv/search/subject/${encodeURIComponent(title)}?type=2`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(
          "[SmartSearch] Bangumi API request failed with status:",
          $toString(response.status),
        );
        return null;
      }

      const data = response.json();
      if (data && data.list && data.list.length > 0) {
        const bangumiId = $toString(data.list[0].id);
        console.log("[SmartSearch] Found Bangumi ID:", bangumiId);
        return bangumiId;
      }
    } catch (err) {
      console.log("[SmartSearch] Error fetching Bangumi ID:", $toString(err));
    }

    return null;
  }

  private async getMikanIdFromBangumi(
    bangumiId: string,
  ): Promise<string | null> {
    console.log("[SmartSearch] Mapping Bangumi ID to Mikan ID:", bangumiId);

    try {
      const response = await fetch(this.bangumiMikanMappingUrl);
      if (!response.ok) {
        console.log(
          "[SmartSearch] Mapping JSON request failed with status:",
          $toString(response.status),
        );
        return null;
      }

      const mapping: Record<string, string> = response.json();
      for (const mikanId in mapping) {
        if (mapping[mikanId] === bangumiId) {
          console.log(
            "[SmartSearch] Successfully mapped to Mikan ID:",
            mikanId,
          );
          return mikanId;
        }
      }
    } catch (err) {
      console.log(
        "[SmartSearch] Error fetching or parsing Mikan mapping JSON:",
        $toString(err),
      );
    }

    console.log(
      "[SmartSearch] No Mikan ID mapping found for Bangumi ID:",
      bangumiId,
    );
    return null;
  }

  private async resolveMikanId(
    opts: AnimeSmartSearchOptions,
  ): Promise<string | null> {
    const primaryTitle = opts.media.romajiTitle || opts.media.englishTitle;

    if (!primaryTitle) {
      console.log("[SmartSearch] No primary title available in media object.");
      return null;
    }

    console.log("[SmartSearch] Resolution for primary title:", primaryTitle);
    let bangumiId = await this.getBangumiId(primaryTitle);

    if (!bangumiId && opts.media.englishTitle && opts.media.romajiTitle) {
      const fallbackTitle =
        primaryTitle === opts.media.romajiTitle
          ? opts.media.englishTitle
          : opts.media.romajiTitle;
      console.log(
        "[SmartSearch] Retrying Bangumi search using fallback title:",
        fallbackTitle,
      );
      bangumiId = await this.getBangumiId(fallbackTitle);
    }

    if (!bangumiId) {
      console.log("[SmartSearch] Could not determine Bangumi ID.");
      return null;
    }

    return await this.getMikanIdFromBangumi(bangumiId);
  }
}
