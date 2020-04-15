'use strict';

const cloudscraper = require('cloudscraper');

const {
    SearchResult,
    Episode
} = require('./common');

const {
    getHeaders,
    formatQualities
} = require('../utils');

const ANIME_URL = 'https://animepahe.com/anime/';
const API_URL = 'https://animepahe.com/api';

const ANIME_ID_REG = /&id=(\d+)/;
const SERVER_REG = /data-provider="([^"]+)/g;
const ID_SESSION_REG = /getEmbeds\((\d+), "([^"]+)/g;
const TITLE_REG = /<h1>([^<]+)/;

const SUPPORTED_SERVERS = ['kwik', 'mp4upload'];

const DEFAULT_HEADERS = getHeaders({ 'Referer': 'https://animepahe.com/' });

// Formats animepahe search results
function handleSearchResult(searchResult) {
    const title = searchResult.title;
    const url = `${ANIME_URL}${searchResult.slug}`;
    const poster = searchResult.image;
    return new SearchResult(title, url, poster);
}

// Returns search results from animepahe for the given query
async function search(query) {
    const searchParams = { l: 8, m: 'search', q: query };
    const response = await cloudscraper.get(API_URL, { qs: searchParams, headers: DEFAULT_HEADERS });
    const results = JSON.parse(response);
    return results.data ? results.data.map(handleSearchResult) : [];
}

// Returns page information from animepahe api
async function getPageData(animeID, page = 1) {
    const params = { m: 'release', id: animeID, sort: 'episode_asc', page: page };
    const response = await cloudscraper.get(API_URL, { qs: params, headers: DEFAULT_HEADERS });
    const data = JSON.parse(response);
    return data;
}

// Retrieves episode data from animepahe api page results
function getEpisodes(title, url, animeData) {
    let episodes = [];
    const data = animeData.data ? animeData.data : [];

    for (const { episode: episodeNum, id } of data) {
        const _title = `${title} Episode ${episodeNum}`;
        const _url = `${url}/${id}`;
        const episode = new Episode(_title, _url);
        episodes.push(episode);
    }
    return episodes;
}

// Collects relevant details of anime such as title, description and episodes
async function getAnime(url) {
    const page = await cloudscraper.get(url, { headers: DEFAULT_HEADERS });
    const [, title,] = TITLE_REG.exec(page);
    const [, animeID,] = ANIME_ID_REG.exec(page);
    if (!animeID) throw new Error(`Failed to find anime id for url: ${url}`);

    let pageData = await getPageData(animeID);
    let episodes = getEpisodes(title, url, pageData);
    let startPage = pageData.current_page, lastPage = pageData.last_page;

    if (startPage < lastPage) {
        startPage++, lastPage++;
        for (let i = startPage; i < lastPage; i++) {
            pageData = await getPageData(animeID, i);
            episodes = episodes.concat(getEpisodes(title, url, pageData));
        }
    }

    return episodes;
}

// Extracts all the servers that are hosting the episode
function getServers(page) {
    let servers = [], match, server;
    do {
        match = SERVER_REG.exec(page);
        if (match) {
            [, server,] = match;
            servers.push(server);
        }
    } while (match);
    return servers;
}

// Extracts the qualities for a given episode returning a mapping of
// qualities and their associated urls
async function getEpisodeQualities(server, episodeID, session) {
    let qualities = new Map();
    const params = { 'id': episodeID, 'm': 'embed', 'p': server, 'session': session };
    const apiResult = await cloudscraper.get(API_URL, { qs: params, headers: DEFAULT_HEADERS });

    if (apiResult === '') throw new Error(`Incorrect API usage with parameters: ${params}`);
    const providerInfo = Object.values(JSON.parse(apiResult).data);

    for (const info of providerInfo) {
        const [quality] = Object.keys(info);
        qualities.set(`${quality}p`, info[quality].url);
    }
    return qualities;
}

// Extracts episode data for animepahe
async function getQualities(url) {
    let qualities;
    const episodePage = await cloudscraper.get(url, { headers: DEFAULT_HEADERS });
    const servers = getServers(episodePage);
    const [, episodeID, session,] = ID_SESSION_REG.exec(episodePage);

    if (!servers) throw new Error(`No servers found for ${title} with url ${url}`);
    // We only get the necessary qualities and urls from one server while ignoring unsupported ones
    for (const server of servers) {
        if (!SUPPORTED_SERVERS.includes(server)) continue;
        qualities = await getEpisodeQualities(server, episodeID, session);
        qualities = formatQualities(qualities, {
            extractor: server,
            referer: url
        });
        break;
    }

    return { qualities };
}

module.exports = {
    search,
    getAnime,
    getQualities
}
