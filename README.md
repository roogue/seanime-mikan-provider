# Mikanani Smart Search for Seanime
## The Problem
Finding reliable extensions that fetch Chinese-subbed anime can be frustrating. Even when you do find one, you often run into issues like mismatched episodes, incorrect seasons, or a complete lack of smart search capabilities. Users are frequently forced to endlessly adjust their search queries just to find the right torrent. Standard extensions simply struggle to map and filter these specific releases accurately.

## The Solution
This extension solves these issues by introducing a (more?) accurate search system tailored specifically for Mikanani:

1. The extension grabs the Anilist title (Romaji or English) directly from Seanime, queries Bangumi to retrieve the accurate BangumiID, and maps it to the corresponding MikanID.

2. Then, it searches Mikan's RSS feeds prioritizing your preferred subtitle groups.

3. Raw torrent names are then tokenized and scored (using seeders field for auto sorting).

## How to Set Subgroups
You can configure the extension to prioritize your favorite Chinese subtitle groups so their releases are searched first.

1. Locate your desired group's ID on Mikanani (this is usually found in the RSS URL when filtering by a specific group, e.g. https://mikanani.me/RSS/Bangumi?bangumiId=xxx&subgroupid=370).

- Examples: LoliHouse is 370 and ANi is 583.

2. Open your Seanime extension settings and find the User Preferences section.

3. Input your desired IDs into the preferred_subgroups key, separated by commas (e.g., 370,583).
