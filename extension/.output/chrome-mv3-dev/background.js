var background = (function() {
	// node_modules/wxt/dist/browser.mjs
	/**
	* Contains the `browser` export which you should use to access the extension
	* APIs in your project:
	*
	* ```ts
	* import { browser } from 'wxt/browser';
	*
	* browser.runtime.onInstalled.addListener(() => {
	*   // ...
	* });
	* ```
	*
	* @module wxt/browser
	*/
	var browser = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
	// node_modules/wxt/dist/utils/define-background.mjs
	function defineBackground(arg) {
		if (arg == null || typeof arg === "function") return { main: arg };
		return arg;
	}
	// src/lib/url-utils.ts
	/**
	* Liste bekannter Tracking- und Session-Parameter, die niemals
	* identitätsstiftend für den Inhalt einer Seite sind.
	*/
	var TRACKING_PARAMS = /* @__PURE__ */ new Set([
		"utm_source",
		"utm_medium",
		"utm_campaign",
		"utm_term",
		"utm_content",
		"ref",
		"ref_",
		"fbclid",
		"gclid",
		"gclsrc",
		"dclid",
		"msclkid",
		"mc_eid",
		"zanpid",
		"igshid",
		"si",
		"feature",
		"spm_id_from",
		"from_source",
		"session_id",
		"sessionId"
	]);
	var LOCALHOST_NAMES = /* @__PURE__ */ new Set(["localhost", "localhost.localdomain"]);
	function parseIpv4Octets(host) {
		const parts = host.split(".");
		if (parts.length !== 4) return null;
		const octets = [];
		for (const part of parts) {
			if (!/^\d{1,3}$/.test(part)) return null;
			const n = Number(part);
			if (n > 255) return null;
			octets.push(n);
		}
		return octets;
	}
	/** Host blocklist for chat rooms (local/private only, not content categories). */
	function isPrivateOrLocalHost(hostname) {
		const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
		if (LOCALHOST_NAMES.has(host)) return true;
		if (host === "0.0.0.0") return true;
		if (host.includes(":")) {
			if (host === "::1") return true;
			if (host.startsWith("fe80:")) return true;
			if (host.startsWith("fc") || host.startsWith("fd")) return true;
			return false;
		}
		const octets = parseIpv4Octets(host);
		if (!octets) return false;
		const [a, b] = octets;
		if (a === 127) return true;
		if (a === 10) return true;
		if (a === 172 && b !== void 0 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 169 && b === 254) return true;
		return false;
	}
	function isChatEligibleParsedUrl(parsed) {
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		return !isPrivateOrLocalHost(parsed.hostname);
	}
	/**
	* Normalisiert eine Web-URL semantisch:
	* 1. Nur öffentliche http(s)-URLs (siehe url-eligibility.md)
	* 2. Plattform-Ausnahmen (YouTube, Amazon, etc.)
	* 3. Bereinigung von Tracking- und Session-Parametern
	* 4. Entfernung von URL-Hashes (#anchors)
	*/
	function cleanUrl(rawUrl) {
		try {
			const parsed = new URL(rawUrl);
			if (!isChatEligibleParsedUrl(parsed)) return "";
			const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
			if (hostname === "youtube.com" || hostname === "m.youtube.com") {
				if (parsed.pathname === "/watch") {
					const videoId = parsed.searchParams.get("v");
					if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
				}
				if (parsed.pathname.startsWith("/shorts/")) {
					const id = parsed.pathname.split("/")[2];
					if (id) return `https://www.youtube.com/watch?v=${id}`;
				}
			} else if (hostname === "youtu.be") {
				const id = parsed.pathname.replace(/^\//, "").split("/")[0];
				if (id) return `https://www.youtube.com/watch?v=${id}`;
			}
			if (hostname.includes("amazon.")) {
				const asin = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1];
				if (asin) return `https://${hostname}/dp/${asin.toUpperCase()}`;
			}
			if (hostname.includes("google.") && parsed.pathname === "/search") {
				const query = parsed.searchParams.get("q");
				if (query) return `https://${hostname}/search?q=${encodeURIComponent(query)}`;
			}
			if (hostname.includes("reddit.com")) {
				const redditMatch = parsed.pathname.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
				const subreddit = redditMatch?.[1];
				const postId = redditMatch?.[2];
				if (subreddit && postId) return `https://www.reddit.com/r/${subreddit.toLowerCase()}/comments/${postId}/`;
			}
			const searchParams = new URLSearchParams();
			parsed.searchParams.forEach((val, key) => {
				const lowerKey = key.toLowerCase();
				if (!TRACKING_PARAMS.has(lowerKey) && !lowerKey.startsWith("utm_")) searchParams.append(key, val);
			});
			searchParams.sort();
			const query = searchParams.toString();
			let pathname = parsed.pathname;
			if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
			return `${parsed.origin}${pathname}${query ? `?${query}` : ""}`;
		} catch {
			return "";
		}
	}
	// src/entrypoints/background.ts
	var SPACETIMEDB_SQL_URL = "https://maincloud.spacetimedb.com/v1/database/wepchat/sql";
	var BADGE_COLOR = "#2563EB";
	var countCache = /* @__PURE__ */ new Map();
	var CACHE_TTL_MS = 1e4;
	/**
	* Fragt die SpacetimeDB per leichtem HTTP-SQL-Endpoint ab
	*/
	async function fetchOnlineCount(url) {
		const cached = countCache.get(url);
		if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.count;
		const query = `SELECT count(*) as total FROM user_session WHERE current_url = '${url.replace(/'/g, "''")}'`;
		try {
			const response = await fetch(SPACETIMEDB_SQL_URL, {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: query
			});
			if (!response.ok) return 0;
			const data = await response.json();
			const count = Number(data?.[0]?.rows?.[0]?.[0] ?? 0);
			countCache.set(url, {
				count,
				timestamp: Date.now()
			});
			return count;
		} catch (err) {
			console.warn("[WepChat Background] Fehler beim Abrufen des Online-Counts:", err);
			return 0;
		}
	}
	/**
	* Formatiert den Badge-Text:
	* <= 1: leer (kein visueller Lärm)
	* 2 - 999: genaue Zahl
	* >= 1000: "99+"
	*/
	function formatBadgeText(count) {
		if (count <= 1) return "";
		if (count > 999) return "99+";
		return String(count);
	}
	/**
	* Aktualisiert den Badge für einen spezifischen Tab
	*/
	async function updateBadgeForTab(tabId, rawUrl) {
		if (!tabId || tabId === browser.tabs.TAB_ID_NONE) return;
		if (!rawUrl) try {
			rawUrl = (await browser.tabs.get(tabId))?.url;
		} catch {
			return;
		}
		const url = cleanUrl(rawUrl || "");
		if (!url) {
			browser.action.setBadgeText({
				text: "",
				tabId
			}).catch(() => {});
			return;
		}
		const badgeText = formatBadgeText(await fetchOnlineCount(url));
		try {
			await browser.action.setBadgeText({
				text: badgeText,
				tabId
			});
			if (badgeText) await browser.action.setBadgeBackgroundColor({
				color: BADGE_COLOR,
				tabId
			});
		} catch {}
	}
	var background_default = defineBackground(() => {
		const sidePanel = chrome.sidePanel;
		if (sidePanel?.setPanelBehavior) sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error("Fehler bei setPanelBehavior:", error));
		browser.action.onClicked.addListener(async (tab) => {
			if (tab.windowId && sidePanel?.open) await sidePanel.open({ windowId: tab.windowId }).catch(console.error);
		});
		browser.tabs.onActivated.addListener(async (activeInfo) => {
			await updateBadgeForTab(activeInfo.tabId);
		});
		browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
			if (changeInfo.url || changeInfo.status === "complete") await updateBadgeForTab(tabId, tab.url);
		});
	});
	// node_modules/@webext-core/match-patterns/dist/index.mjs
	/**
	* Class for parsing and performing operations on match patterns.
	*
	* @example
	*   const pattern = new MatchPattern('*://google.com/*');
	*
	*   pattern.includes('https://google.com'); // true
	*   pattern.includes('http://youtube.com/watch?v=123'); // false
	*/
	var MatchPattern = class MatchPattern {
		static {
			this.PROTOCOLS = [
				"http",
				"https",
				"file",
				"ftp",
				"urn",
				"ws",
				"wss"
			];
		}
		/**
		* Parse a match pattern string. If it is invalid, the constructor will throw an
		* `InvalidMatchPattern` error.
		*
		* @param matchPattern The match pattern to parse.
		*/
		constructor(matchPattern) {
			if (matchPattern === "<all_urls>") {
				this.isAllUrls = true;
				this.protocolMatches = [...MatchPattern.PROTOCOLS];
				this.hostnameMatch = "*";
				this.pathnameMatch = "*";
			} else {
				const groups = /(.*):\/\/(.*?)(\/.*)/.exec(matchPattern);
				if (groups == null) throw new InvalidMatchPattern(matchPattern, "Incorrect format");
				const [_, protocol, hostname, pathname] = groups;
				validateProtocol(matchPattern, protocol);
				validateHostname(matchPattern, hostname);
				this.protocolMatches = protocol === "*" ? ["http", "https"] : [protocol];
				this.hostnameMatch = hostname;
				this.pathnameMatch = pathname;
			}
		}
		/** Check if a URL is included in a pattern. */
		includes(url) {
			const u = typeof url === "string" ? new URL(url) : url instanceof Location ? new URL(url.href) : url;
			if (this.isAllUrls) return !this.isUnknownProtocol(u);
			return !!this.protocolMatches.find((protocol) => {
				if (protocol === "http") return this.isHttpMatch(u);
				if (protocol === "https") return this.isHttpsMatch(u);
				if (protocol === "file") return this.isFileMatch(u);
				if (protocol === "ftp") return this.isFtpMatch(u);
				if (protocol === "urn") return this.isUrnMatch(u);
			});
		}
		isHttpMatch(url) {
			return url.protocol === "http:" && this.isHostPathMatch(url);
		}
		isHttpsMatch(url) {
			return url.protocol === "https:" && this.isHostPathMatch(url);
		}
		isHostPathMatch(url) {
			if (!this.hostnameMatch || !this.pathnameMatch) return false;
			const hostnameMatchRegexs = [this.convertPatternToRegex(this.hostnameMatch), this.convertPatternToRegex(this.hostnameMatch.replace(/^\*\./, ""))];
			const pathnameMatchRegex = this.convertPatternToRegex(this.pathnameMatch);
			return !!hostnameMatchRegexs.find((regex) => regex.test(url.hostname)) && pathnameMatchRegex.test(url.pathname);
		}
		isUnknownProtocol(url) {
			return !this.protocolMatches.includes(url.protocol.slice(0, -1));
		}
		isPathMatch(url) {
			if (!this.pathnameMatch) return false;
			return this.convertPatternToRegex(this.pathnameMatch).test(url.pathname);
		}
		isFileMatch(url) {
			return url.protocol === "file:" && this.isPathMatch(url);
		}
		isFtpMatch(_url) {
			throw Error("Not implemented: ftp:// pattern matching. Open a PR to add support");
		}
		isUrnMatch(_url) {
			throw Error("Not implemented: urn:// pattern matching. Open a PR to add support");
		}
		convertPatternToRegex(pattern) {
			const starsReplaced = this.escapeForRegex(pattern).replace(/\\\*/g, ".*");
			return RegExp(`^${starsReplaced}$`);
		}
		escapeForRegex(string) {
			return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	};
	var InvalidMatchPattern = class extends Error {
		constructor(matchPattern, reason) {
			super(`Invalid match pattern "${matchPattern}": ${reason}`);
		}
	};
	function validateProtocol(matchPattern, protocol) {
		if (!MatchPattern.PROTOCOLS.includes(protocol) && protocol !== "*") throw new InvalidMatchPattern(matchPattern, `${protocol} not a valid protocol (${MatchPattern.PROTOCOLS.join(", ")})`);
	}
	function validateHostname(matchPattern, hostname) {
		if (hostname.includes(":")) throw new InvalidMatchPattern(matchPattern, `Hostname cannot include a port`);
		if (hostname.includes("*") && hostname.length > 1 && !hostname.startsWith("*.")) throw new InvalidMatchPattern(matchPattern, `If using a wildcard (*), it must go at the start of the hostname`);
	}
	// \0virtual:wxt-background-entrypoint?/Users/johann/MyBrew/WepChat/extension/src/entrypoints/background.ts
	function print(method, ...args) {
		if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
		else method("[wxt]", ...args);
	}
	/** Wrapper around `console` with a "[wxt]" prefix */
	var logger = {
		debug: (...args) => print(console.debug, ...args),
		log: (...args) => print(console.log, ...args),
		warn: (...args) => print(console.warn, ...args),
		error: (...args) => print(console.error, ...args)
	};
	var ws;
	/** Connect to the websocket and listen for messages. */
	function getDevServerWebSocket() {
		if (ws == null) {
			const serverUrl = "ws://localhost:3000";
			logger.debug("Connecting to dev server @", serverUrl);
			ws = new WebSocket(serverUrl, "vite-hmr");
			ws.addWxtEventListener = ws.addEventListener.bind(ws);
			ws.sendCustom = (event, payload) => ws?.send(JSON.stringify({
				type: "custom",
				event,
				payload
			}));
			ws.addEventListener("open", () => {
				logger.debug("Connected to dev server");
			});
			ws.addEventListener("close", () => {
				logger.debug("Disconnected from dev server");
			});
			ws.addEventListener("error", (event) => {
				logger.error("Failed to connect to dev server", event);
			});
			ws.addEventListener("message", (e) => {
				try {
					const message = JSON.parse(e.data);
					if (message.type === "custom") ws?.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
				} catch (err) {
					logger.error("Failed to handle message", err);
				}
			});
		}
		return ws;
	}
	/** https://developer.chrome.com/blog/longer-esw-lifetimes/ */
	function keepServiceWorkerAlive() {
		setInterval(async () => {
			await browser.runtime.getPlatformInfo();
		}, 5e3);
	}
	function reloadContentScript(payload) {
		if (browser.runtime.getManifest().manifest_version == 2) reloadContentScriptMv2(payload);
		else reloadContentScriptMv3(payload);
	}
	async function reloadContentScriptMv3({ registration, contentScript }) {
		if (registration === "runtime") await reloadRuntimeContentScriptMv3(contentScript);
		else await reloadManifestContentScriptMv3(contentScript);
	}
	async function reloadManifestContentScriptMv3(contentScript) {
		const id = `wxt:${contentScript.js[0]}`;
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const existing = registered.find((cs) => cs.id === id);
		if (existing) {
			logger.debug("Updating content script", existing);
			await browser.scripting.updateContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		} else {
			logger.debug("Registering new content script...");
			await browser.scripting.registerContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		}
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadRuntimeContentScriptMv3(contentScript) {
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const matches = registered.filter((cs) => {
			const hasJs = contentScript.js?.find((js) => cs.js?.includes(js));
			const hasCss = contentScript.css?.find((css) => cs.css?.includes(css));
			return hasJs || hasCss;
		});
		if (matches.length === 0) {
			logger.log("Content script is not registered yet, nothing to reload", contentScript);
			return;
		}
		await browser.scripting.updateContentScripts(matches);
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadTabsForContentScript(contentScript) {
		const allTabs = await browser.tabs.query({});
		const matchPatterns = contentScript.matches.map((match) => new MatchPattern(match));
		const matchingTabs = allTabs.filter((tab) => {
			const url = tab.url;
			if (!url) return false;
			return !!matchPatterns.find((pattern) => pattern.includes(url));
		});
		await Promise.all(matchingTabs.map(async (tab) => {
			try {
				await browser.tabs.reload(tab.id);
			} catch (err) {
				logger.warn("Failed to reload tab:", err);
			}
		}));
	}
	async function reloadContentScriptMv2(_payload) {
		throw Error("TODO: reloadContentScriptMv2");
	}
	try {
		const ws = getDevServerWebSocket();
		ws.addWxtEventListener("wxt:reload-extension", () => {
			browser.runtime.reload();
		});
		ws.addWxtEventListener("wxt:reload-content-script", (event) => {
			reloadContentScript(event.detail);
		});
		ws.addEventListener("open", () => ws.sendCustom("wxt:background-initialized"));
		keepServiceWorkerAlive();
	} catch (err) {
		logger.error("Failed to setup web socket connection with dev server", err);
	}
	browser.commands.onCommand.addListener((command) => {
		if (command === "wxt:reload-extension") browser.runtime.reload();
	});
	var result;
	try {
		result = background_default.main();
		if (result instanceof Promise) console.warn("The background's main() function return a promise, but it must be synchronous");
	} catch (err) {
		logger.error("The background crashed on startup!");
		throw err;
	}
	return result;
})();

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiLCJiYWNrZ3JvdW5kX2VudHJ5cG9pbnRfZGVmYXVsdCJdLCJzb3VyY2VzIjpbIi4uLy4uL25vZGVfbW9kdWxlcy9Ad3h0LWRldi9icm93c2VyL3NyYy9pbmRleC5tanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvYnJvd3Nlci5tanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQubWpzIiwiLi4vLi4vc3JjL2xpYi91cmwtdXRpbHMudHMiLCIuLi8uLi9zcmMvZW50cnlwb2ludHMvYmFja2dyb3VuZC50cyIsIi4uLy4uL25vZGVfbW9kdWxlcy9Ad2ViZXh0LWNvcmUvbWF0Y2gtcGF0dGVybnMvZGlzdC9pbmRleC5tanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gI3JlZ2lvbiBzbmlwcGV0XG5leHBvcnQgY29uc3QgYnJvd3NlciA9IGdsb2JhbFRoaXMuYnJvd3Nlcj8ucnVudGltZT8uaWRcbiAgPyBnbG9iYWxUaGlzLmJyb3dzZXJcbiAgOiBnbG9iYWxUaGlzLmNocm9tZTtcbi8vICNlbmRyZWdpb24gc25pcHBldFxuIiwiaW1wb3J0IHsgYnJvd3NlciBhcyBicm93c2VyJDEgfSBmcm9tIFwiQHd4dC1kZXYvYnJvd3NlclwiO1xuLy8jcmVnaW9uIHNyYy9icm93c2VyLnRzXG4vKipcbiogQ29udGFpbnMgdGhlIGBicm93c2VyYCBleHBvcnQgd2hpY2ggeW91IHNob3VsZCB1c2UgdG8gYWNjZXNzIHRoZSBleHRlbnNpb25cbiogQVBJcyBpbiB5b3VyIHByb2plY3Q6XG4qXG4qIGBgYHRzXG4qIGltcG9ydCB7IGJyb3dzZXIgfSBmcm9tICd3eHQvYnJvd3Nlcic7XG4qXG4qIGJyb3dzZXIucnVudGltZS5vbkluc3RhbGxlZC5hZGRMaXN0ZW5lcigoKSA9PiB7XG4qICAgLy8gLi4uXG4qIH0pO1xuKiBgYGBcbipcbiogQG1vZHVsZSB3eHQvYnJvd3NlclxuKi9cbmNvbnN0IGJyb3dzZXIgPSBicm93c2VyJDE7XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGJyb3dzZXIgfTtcbiIsIi8vI3JlZ2lvbiBzcmMvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQudHNcbmZ1bmN0aW9uIGRlZmluZUJhY2tncm91bmQoYXJnKSB7XG5cdGlmIChhcmcgPT0gbnVsbCB8fCB0eXBlb2YgYXJnID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiB7IG1haW46IGFyZyB9O1xuXHRyZXR1cm4gYXJnO1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBkZWZpbmVCYWNrZ3JvdW5kIH07XG4iLCIvKipcbiAqIExpc3RlIGJla2FubnRlciBUcmFja2luZy0gdW5kIFNlc3Npb24tUGFyYW1ldGVyLCBkaWUgbmllbWFsc1xuICogaWRlbnRpdMOkdHNzdGlmdGVuZCBmw7xyIGRlbiBJbmhhbHQgZWluZXIgU2VpdGUgc2luZC5cbiAqL1xuY29uc3QgVFJBQ0tJTkdfUEFSQU1TID0gbmV3IFNldChbXG4gICd1dG1fc291cmNlJyxcbiAgJ3V0bV9tZWRpdW0nLFxuICAndXRtX2NhbXBhaWduJyxcbiAgJ3V0bV90ZXJtJyxcbiAgJ3V0bV9jb250ZW50JyxcbiAgJ3JlZicsXG4gICdyZWZfJyxcbiAgJ2ZiY2xpZCcsXG4gICdnY2xpZCcsXG4gICdnY2xzcmMnLFxuICAnZGNsaWQnLFxuICAnbXNjbGtpZCcsXG4gICdtY19laWQnLFxuICAnemFucGlkJyxcbiAgJ2lnc2hpZCcsXG4gICdzaScsIC8vIFNwb3RpZnkgLyBZb3VUdWJlIHNoYXJlIHRyYWNrZXJcbiAgJ2ZlYXR1cmUnLCAvLyBZb3VUdWJlIHNoYXJlIHRyYWNrZXJcbiAgJ3NwbV9pZF9mcm9tJywgLy8gQmlsaWJpbGkgdHJhY2tlclxuICAnZnJvbV9zb3VyY2UnLFxuICAnc2Vzc2lvbl9pZCcsXG4gICdzZXNzaW9uSWQnLFxuXSk7XG5cbmNvbnN0IExPQ0FMSE9TVF9OQU1FUyA9IG5ldyBTZXQoWydsb2NhbGhvc3QnLCAnbG9jYWxob3N0LmxvY2FsZG9tYWluJ10pO1xuXG5leHBvcnQgdHlwZSBUYWJDaGF0VXJsU3RhdGUgPVxuICB8IHsga2luZDogJ25vbmUnIH1cbiAgfCB7IGtpbmQ6ICd1bnN1cHBvcnRlZCcgfVxuICB8IHsga2luZDogJ3JlYWR5JzsgdXJsOiBzdHJpbmcgfTtcblxuZnVuY3Rpb24gcGFyc2VJcHY0T2N0ZXRzKGhvc3Q6IHN0cmluZyk6IG51bWJlcltdIHwgbnVsbCB7XG4gIGNvbnN0IHBhcnRzID0gaG9zdC5zcGxpdCgnLicpO1xuICBpZiAocGFydHMubGVuZ3RoICE9PSA0KSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgb2N0ZXRzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICBpZiAoIS9eXFxkezEsM30kLy50ZXN0KHBhcnQpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBuID0gTnVtYmVyKHBhcnQpO1xuICAgIGlmIChuID4gMjU1KSByZXR1cm4gbnVsbDtcbiAgICBvY3RldHMucHVzaChuKTtcbiAgfVxuICByZXR1cm4gb2N0ZXRzO1xufVxuXG4vKiogSG9zdCBibG9ja2xpc3QgZm9yIGNoYXQgcm9vbXMgKGxvY2FsL3ByaXZhdGUgb25seSwgbm90IGNvbnRlbnQgY2F0ZWdvcmllcykuICovXG5leHBvcnQgZnVuY3Rpb24gaXNQcml2YXRlT3JMb2NhbEhvc3QoaG9zdG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBob3N0ID0gaG9zdG5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9eXFxbfFxcXSQvZywgJycpO1xuXG4gIGlmIChMT0NBTEhPU1RfTkFNRVMuaGFzKGhvc3QpKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKGhvc3QgPT09ICcwLjAuMC4wJykgcmV0dXJuIHRydWU7XG5cbiAgaWYgKGhvc3QuaW5jbHVkZXMoJzonKSkge1xuICAgIGlmIChob3N0ID09PSAnOjoxJykgcmV0dXJuIHRydWU7XG4gICAgaWYgKGhvc3Quc3RhcnRzV2l0aCgnZmU4MDonKSkgcmV0dXJuIHRydWU7XG4gICAgaWYgKGhvc3Quc3RhcnRzV2l0aCgnZmMnKSB8fCBob3N0LnN0YXJ0c1dpdGgoJ2ZkJykpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGNvbnN0IG9jdGV0cyA9IHBhcnNlSXB2NE9jdGV0cyhob3N0KTtcbiAgaWYgKCFvY3RldHMpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBbYSwgYl0gPSBvY3RldHM7XG4gIGlmIChhID09PSAxMjcpIHJldHVybiB0cnVlO1xuICBpZiAoYSA9PT0gMTApIHJldHVybiB0cnVlO1xuICBpZiAoYSA9PT0gMTcyICYmIGIgIT09IHVuZGVmaW5lZCAmJiBiID49IDE2ICYmIGIgPD0gMzEpIHJldHVybiB0cnVlO1xuICBpZiAoYSA9PT0gMTkyICYmIGIgPT09IDE2OCkgcmV0dXJuIHRydWU7XG4gIGlmIChhID09PSAxNjkgJiYgYiA9PT0gMjU0KSByZXR1cm4gdHJ1ZTtcblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0NoYXRFbGlnaWJsZVBhcnNlZFVybChwYXJzZWQ6IFVSTCk6IGJvb2xlYW4ge1xuICBpZiAocGFyc2VkLnByb3RvY29sICE9PSAnaHR0cDonICYmIHBhcnNlZC5wcm90b2NvbCAhPT0gJ2h0dHBzOicpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuICFpc1ByaXZhdGVPckxvY2FsSG9zdChwYXJzZWQuaG9zdG5hbWUpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRhYkNoYXRVcmwocmF3VXJsOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBUYWJDaGF0VXJsU3RhdGUge1xuICBpZiAoIXJhd1VybD8udHJpbSgpKSByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKHJhd1VybCk7XG4gICAgaWYgKCFpc0NoYXRFbGlnaWJsZVBhcnNlZFVybChwYXJzZWQpKSB7XG4gICAgICByZXR1cm4geyBraW5kOiAndW5zdXBwb3J0ZWQnIH07XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbiAgfVxuXG4gIGNvbnN0IHVybCA9IGNsZWFuVXJsKHJhd1VybCk7XG4gIGlmICghdXJsKSByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3JlYWR5JywgdXJsIH07XG59XG5cbi8qKlxuICogTm9ybWFsaXNpZXJ0IGVpbmUgV2ViLVVSTCBzZW1hbnRpc2NoOlxuICogMS4gTnVyIMO2ZmZlbnRsaWNoZSBodHRwKHMpLVVSTHMgKHNpZWhlIHVybC1lbGlnaWJpbGl0eS5tZClcbiAqIDIuIFBsYXR0Zm9ybS1BdXNuYWhtZW4gKFlvdVR1YmUsIEFtYXpvbiwgZXRjLilcbiAqIDMuIEJlcmVpbmlndW5nIHZvbiBUcmFja2luZy0gdW5kIFNlc3Npb24tUGFyYW1ldGVyblxuICogNC4gRW50ZmVybnVuZyB2b24gVVJMLUhhc2hlcyAoI2FuY2hvcnMpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhblVybChyYXdVcmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTChyYXdVcmwpO1xuICAgIGlmICghaXNDaGF0RWxpZ2libGVQYXJzZWRVcmwocGFyc2VkKSkgcmV0dXJuICcnO1xuXG4gICAgY29uc3QgaG9zdG5hbWUgPSBwYXJzZWQuaG9zdG5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9ed3d3XFwuLywgJycpO1xuXG4gICAgLy8gMS4gWW91VHViZVxuICAgIGlmIChob3N0bmFtZSA9PT0gJ3lvdXR1YmUuY29tJyB8fCBob3N0bmFtZSA9PT0gJ20ueW91dHViZS5jb20nKSB7XG4gICAgICBpZiAocGFyc2VkLnBhdGhuYW1lID09PSAnL3dhdGNoJykge1xuICAgICAgICBjb25zdCB2aWRlb0lkID0gcGFyc2VkLnNlYXJjaFBhcmFtcy5nZXQoJ3YnKTtcbiAgICAgICAgaWYgKHZpZGVvSWQpIHtcbiAgICAgICAgICByZXR1cm4gYGh0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9JHt2aWRlb0lkfWA7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFlvdVR1YmUgU2hvcnRzOiBodHRwczovL3d3dy55b3V0dWJlLmNvbS9zaG9ydHMve2lkfVxuICAgICAgaWYgKHBhcnNlZC5wYXRobmFtZS5zdGFydHNXaXRoKCcvc2hvcnRzLycpKSB7XG4gICAgICAgIGNvbnN0IHBhcnRzID0gcGFyc2VkLnBhdGhuYW1lLnNwbGl0KCcvJyk7XG4gICAgICAgIGNvbnN0IGlkID0gcGFydHNbMl07XG4gICAgICAgIGlmIChpZCkge1xuICAgICAgICAgIHJldHVybiBgaHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj0ke2lkfWA7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGhvc3RuYW1lID09PSAneW91dHUuYmUnKSB7XG4gICAgICAvLyB5b3V0dS5iZS9JRCBTaG9ydGxpbmtcbiAgICAgIGNvbnN0IGlkID0gcGFyc2VkLnBhdGhuYW1lLnJlcGxhY2UoL15cXC8vLCAnJykuc3BsaXQoJy8nKVswXTtcbiAgICAgIGlmIChpZCkge1xuICAgICAgICByZXR1cm4gYGh0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9JHtpZH1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIDIuIEFtYXpvbiAoYW1hem9uLmRlLCBhbWF6b24uY29tLCBldGMuKVxuICAgIGlmIChob3N0bmFtZS5pbmNsdWRlcygnYW1hem9uLicpKSB7XG4gICAgICBjb25zdCBhc2luTWF0Y2ggPSBwYXJzZWQucGF0aG5hbWUubWF0Y2goL1xcLyg/OmRwfGdwXFwvcHJvZHVjdClcXC8oW0EtWjAtOV17MTB9KS9pKTtcbiAgICAgIGNvbnN0IGFzaW4gPSBhc2luTWF0Y2g/LlsxXTtcbiAgICAgIGlmIChhc2luKSB7XG4gICAgICAgIHJldHVybiBgaHR0cHM6Ly8ke2hvc3RuYW1lfS9kcC8ke2FzaW4udG9VcHBlckNhc2UoKX1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIDMuIEdvb2dsZSBTdWNoZVxuICAgIGlmIChob3N0bmFtZS5pbmNsdWRlcygnZ29vZ2xlLicpICYmIHBhcnNlZC5wYXRobmFtZSA9PT0gJy9zZWFyY2gnKSB7XG4gICAgICBjb25zdCBxdWVyeSA9IHBhcnNlZC5zZWFyY2hQYXJhbXMuZ2V0KCdxJyk7XG4gICAgICBpZiAocXVlcnkpIHtcbiAgICAgICAgcmV0dXJuIGBodHRwczovLyR7aG9zdG5hbWV9L3NlYXJjaD9xPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5KX1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIDQuIFJlZGRpdFxuICAgIGlmIChob3N0bmFtZS5pbmNsdWRlcygncmVkZGl0LmNvbScpKSB7XG4gICAgICBjb25zdCByZWRkaXRNYXRjaCA9IHBhcnNlZC5wYXRobmFtZS5tYXRjaCgvXFwvclxcLyhbXi9dKylcXC9jb21tZW50c1xcLyhbXi9dKykvKTtcbiAgICAgIGNvbnN0IHN1YnJlZGRpdCA9IHJlZGRpdE1hdGNoPy5bMV07XG4gICAgICBjb25zdCBwb3N0SWQgPSByZWRkaXRNYXRjaD8uWzJdO1xuICAgICAgaWYgKHN1YnJlZGRpdCAmJiBwb3N0SWQpIHtcbiAgICAgICAgcmV0dXJuIGBodHRwczovL3d3dy5yZWRkaXQuY29tL3IvJHtzdWJyZWRkaXQudG9Mb3dlckNhc2UoKX0vY29tbWVudHMvJHtwb3N0SWR9L2A7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gNS4gR2VuZXJpc2NoZXIgU3RhbmRhcmQtUGZhZDpcbiAgICAvLyBUcmFja2luZy1QYXJhbWV0ZXIgZW50ZmVybmVuLCBhbGxlIGFuZGVyZW4gKHouIEIuID9pZD0xMjMsID9wYWdlPTIpIHNvcnRpZXJ0IGJlaGFsdGVuXG4gICAgY29uc3Qgc2VhcmNoUGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcygpO1xuICAgIHBhcnNlZC5zZWFyY2hQYXJhbXMuZm9yRWFjaCgodmFsLCBrZXkpID0+IHtcbiAgICAgIGNvbnN0IGxvd2VyS2V5ID0ga2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoIVRSQUNLSU5HX1BBUkFNUy5oYXMobG93ZXJLZXkpICYmICFsb3dlcktleS5zdGFydHNXaXRoKCd1dG1fJykpIHtcbiAgICAgICAgc2VhcmNoUGFyYW1zLmFwcGVuZChrZXksIHZhbCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBzZWFyY2hQYXJhbXMuc29ydCgpO1xuICAgIGNvbnN0IHF1ZXJ5ID0gc2VhcmNoUGFyYW1zLnRvU3RyaW5nKCk7XG5cbiAgICAvLyBUcmFpbGluZyBTbGFzaCBlbnRmZXJuZW4gKGF1w59lciBiZWkgUm9vdCBcIi9cIilcbiAgICBsZXQgcGF0aG5hbWUgPSBwYXJzZWQucGF0aG5hbWU7XG4gICAgaWYgKHBhdGhuYW1lLmxlbmd0aCA+IDEgJiYgcGF0aG5hbWUuZW5kc1dpdGgoJy8nKSkge1xuICAgICAgcGF0aG5hbWUgPSBwYXRobmFtZS5zbGljZSgwLCAtMSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGAke3BhcnNlZC5vcmlnaW59JHtwYXRobmFtZX0ke3F1ZXJ5ID8gYD8ke3F1ZXJ5fWAgOiAnJ31gO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbn1cbiIsImltcG9ydCB7IGNsZWFuVXJsIH0gZnJvbSAnQC9saWIvdXJsLXV0aWxzJztcblxuY29uc3QgU1BBQ0VUSU1FREJfU1FMX1VSTCA9ICdodHRwczovL21haW5jbG91ZC5zcGFjZXRpbWVkYi5jb20vdjEvZGF0YWJhc2Uvd2VwY2hhdC9zcWwnO1xuY29uc3QgQkFER0VfQ09MT1IgPSAnIzI1NjNFQic7IC8vIFdlcENoYXQgQmxhdVxuXG4vLyBLdXJ6ZXIgSW4tTWVtb3J5IENhY2hlIHBybyBVUkwgKDEwcyksIHVtIHJlZHVuZGFudGUgUmVxdWVzdHMgYmVpbSBzY2huZWxsZW4gSGluLSB1bmQgSGVyd2VjaHNlbG4genUgbWluaW1pZXJlblxuY29uc3QgY291bnRDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCB7IGNvdW50OiBudW1iZXI7IHRpbWVzdGFtcDogbnVtYmVyIH0+KCk7XG5jb25zdCBDQUNIRV9UVExfTVMgPSAxMF8wMDA7XG5cbi8qKlxuICogRnJhZ3QgZGllIFNwYWNldGltZURCIHBlciBsZWljaHRlbSBIVFRQLVNRTC1FbmRwb2ludCBhYlxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaE9ubGluZUNvdW50KHVybDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgY29uc3QgY2FjaGVkID0gY291bnRDYWNoZS5nZXQodXJsKTtcbiAgaWYgKGNhY2hlZCAmJiBEYXRlLm5vdygpIC0gY2FjaGVkLnRpbWVzdGFtcCA8IENBQ0hFX1RUTF9NUykge1xuICAgIHJldHVybiBjYWNoZWQuY291bnQ7XG4gIH1cblxuICAvLyBFc2NhcGUgZWluZmFjaGVzIEFuZsO8aHJ1bmdzemVpY2hlbiBmw7xyIFNRTFxuICBjb25zdCBlc2NhcGVkVXJsID0gdXJsLnJlcGxhY2UoLycvZywgXCInJ1wiKTtcbiAgY29uc3QgcXVlcnkgPSBgU0VMRUNUIGNvdW50KCopIGFzIHRvdGFsIEZST00gdXNlcl9zZXNzaW9uIFdIRVJFIGN1cnJlbnRfdXJsID0gJyR7ZXNjYXBlZFVybH0nYDtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goU1BBQ0VUSU1FREJfU1FMX1VSTCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiAndGV4dC9wbGFpbicgfSxcbiAgICAgIGJvZHk6IHF1ZXJ5LFxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXNwb25zZS5vaykgcmV0dXJuIDA7XG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcbiAgICBjb25zdCBjb3VudCA9IE51bWJlcihkYXRhPy5bMF0/LnJvd3M/LlswXT8uWzBdID8/IDApO1xuXG4gICAgY291bnRDYWNoZS5zZXQodXJsLCB7IGNvdW50LCB0aW1lc3RhbXA6IERhdGUubm93KCkgfSk7XG4gICAgcmV0dXJuIGNvdW50O1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zb2xlLndhcm4oJ1tXZXBDaGF0IEJhY2tncm91bmRdIEZlaGxlciBiZWltIEFicnVmZW4gZGVzIE9ubGluZS1Db3VudHM6JywgZXJyKTtcbiAgICByZXR1cm4gMDtcbiAgfVxufVxuXG4vKipcbiAqIEZvcm1hdGllcnQgZGVuIEJhZGdlLVRleHQ6XG4gKiA8PSAxOiBsZWVyIChrZWluIHZpc3VlbGxlciBMw6RybSlcbiAqIDIgLSA5OTk6IGdlbmF1ZSBaYWhsXG4gKiA+PSAxMDAwOiBcIjk5K1wiXG4gKi9cbmZ1bmN0aW9uIGZvcm1hdEJhZGdlVGV4dChjb3VudDogbnVtYmVyKTogc3RyaW5nIHtcbiAgaWYgKGNvdW50IDw9IDEpIHJldHVybiAnJztcbiAgaWYgKGNvdW50ID4gOTk5KSByZXR1cm4gJzk5Kyc7XG4gIHJldHVybiBTdHJpbmcoY291bnQpO1xufVxuXG4vKipcbiAqIEFrdHVhbGlzaWVydCBkZW4gQmFkZ2UgZsO8ciBlaW5lbiBzcGV6aWZpc2NoZW4gVGFiXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZUJhZGdlRm9yVGFiKHRhYklkOiBudW1iZXIsIHJhd1VybD86IHN0cmluZykge1xuICBpZiAoIXRhYklkIHx8IHRhYklkID09PSBicm93c2VyLnRhYnMuVEFCX0lEX05PTkUpIHJldHVybjtcblxuICBpZiAoIXJhd1VybCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB0YWIgPSBhd2FpdCBicm93c2VyLnRhYnMuZ2V0KHRhYklkKTtcbiAgICAgIHJhd1VybCA9IHRhYj8udXJsO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHVybCA9IGNsZWFuVXJsKHJhd1VybCB8fCAnJyk7XG4gIGlmICghdXJsKSB7XG4gICAgYnJvd3Nlci5hY3Rpb24uc2V0QmFkZ2VUZXh0KHsgdGV4dDogJycsIHRhYklkIH0pLmNhdGNoKCgpID0+IHt9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBjb3VudCA9IGF3YWl0IGZldGNoT25saW5lQ291bnQodXJsKTtcbiAgY29uc3QgYmFkZ2VUZXh0ID0gZm9ybWF0QmFkZ2VUZXh0KGNvdW50KTtcblxuICB0cnkge1xuICAgIGF3YWl0IGJyb3dzZXIuYWN0aW9uLnNldEJhZGdlVGV4dCh7IHRleHQ6IGJhZGdlVGV4dCwgdGFiSWQgfSk7XG4gICAgaWYgKGJhZGdlVGV4dCkge1xuICAgICAgYXdhaXQgYnJvd3Nlci5hY3Rpb24uc2V0QmFkZ2VCYWNrZ3JvdW5kQ29sb3IoeyBjb2xvcjogQkFER0VfQ09MT1IsIHRhYklkIH0pO1xuICAgIH1cbiAgfSBjYXRjaCB7XG4gICAgLy8gVGFiIGV2ZW50dWVsbCBzY2hvbiBnZXNjaGxvc3NlblxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUJhY2tncm91bmQoKCkgPT4ge1xuICAvLyBDaHJvbWUtb25seTogU2lkZSBQYW5lbCAoRmlyZWZveCBudXR6dCBzaWRlYmFyX2FjdGlvbiBpbSBNYW5pZmVzdClcbiAgY29uc3Qgc2lkZVBhbmVsID0gY2hyb21lLnNpZGVQYW5lbDtcbiAgaWYgKHNpZGVQYW5lbD8uc2V0UGFuZWxCZWhhdmlvcikge1xuICAgIHNpZGVQYW5lbFxuICAgICAgLnNldFBhbmVsQmVoYXZpb3IoeyBvcGVuUGFuZWxPbkFjdGlvbkNsaWNrOiB0cnVlIH0pXG4gICAgICAuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiBjb25zb2xlLmVycm9yKCdGZWhsZXIgYmVpIHNldFBhbmVsQmVoYXZpb3I6JywgZXJyb3IpKTtcbiAgfVxuXG4gIC8vIEZhbGxiYWNrOiBGYWxscyBzZXRQYW5lbEJlaGF2aW9yIG5pY2h0IHNvZm9ydCBncmVpZnRcbiAgYnJvd3Nlci5hY3Rpb24ub25DbGlja2VkLmFkZExpc3RlbmVyKGFzeW5jICh0YWIpID0+IHtcbiAgICBpZiAodGFiLndpbmRvd0lkICYmIHNpZGVQYW5lbD8ub3Blbikge1xuICAgICAgYXdhaXQgc2lkZVBhbmVsLm9wZW4oeyB3aW5kb3dJZDogdGFiLndpbmRvd0lkIH0pLmNhdGNoKGNvbnNvbGUuZXJyb3IpO1xuICAgIH1cbiAgfSk7XG5cbiAgYnJvd3Nlci50YWJzLm9uQWN0aXZhdGVkLmFkZExpc3RlbmVyKGFzeW5jIChhY3RpdmVJbmZvKSA9PiB7XG4gICAgYXdhaXQgdXBkYXRlQmFkZ2VGb3JUYWIoYWN0aXZlSW5mby50YWJJZCk7XG4gIH0pO1xuXG4gIGJyb3dzZXIudGFicy5vblVwZGF0ZWQuYWRkTGlzdGVuZXIoYXN5bmMgKHRhYklkLCBjaGFuZ2VJbmZvLCB0YWIpID0+IHtcbiAgICBpZiAoY2hhbmdlSW5mby51cmwgfHwgY2hhbmdlSW5mby5zdGF0dXMgPT09ICdjb21wbGV0ZScpIHtcbiAgICAgIGF3YWl0IHVwZGF0ZUJhZGdlRm9yVGFiKHRhYklkLCB0YWIudXJsKTtcbiAgICB9XG4gIH0pO1xufSk7XG4iLCIvLyNyZWdpb24gc3JjL2luZGV4LnRzXG4vKipcbiogQ2xhc3MgZm9yIHBhcnNpbmcgYW5kIHBlcmZvcm1pbmcgb3BlcmF0aW9ucyBvbiBtYXRjaCBwYXR0ZXJucy5cbipcbiogQGV4YW1wbGVcbiogICBjb25zdCBwYXR0ZXJuID0gbmV3IE1hdGNoUGF0dGVybignKjovL2dvb2dsZS5jb20vKicpO1xuKlxuKiAgIHBhdHRlcm4uaW5jbHVkZXMoJ2h0dHBzOi8vZ29vZ2xlLmNvbScpOyAvLyB0cnVlXG4qICAgcGF0dGVybi5pbmNsdWRlcygnaHR0cDovL3lvdXR1YmUuY29tL3dhdGNoP3Y9MTIzJyk7IC8vIGZhbHNlXG4qL1xudmFyIE1hdGNoUGF0dGVybiA9IGNsYXNzIE1hdGNoUGF0dGVybiB7XG5cdHN0YXRpYyB7XG5cdFx0dGhpcy5QUk9UT0NPTFMgPSBbXG5cdFx0XHRcImh0dHBcIixcblx0XHRcdFwiaHR0cHNcIixcblx0XHRcdFwiZmlsZVwiLFxuXHRcdFx0XCJmdHBcIixcblx0XHRcdFwidXJuXCIsXG5cdFx0XHRcIndzXCIsXG5cdFx0XHRcIndzc1wiXG5cdFx0XTtcblx0fVxuXHQvKipcblx0KiBQYXJzZSBhIG1hdGNoIHBhdHRlcm4gc3RyaW5nLiBJZiBpdCBpcyBpbnZhbGlkLCB0aGUgY29uc3RydWN0b3Igd2lsbCB0aHJvdyBhblxuXHQqIGBJbnZhbGlkTWF0Y2hQYXR0ZXJuYCBlcnJvci5cblx0KlxuXHQqIEBwYXJhbSBtYXRjaFBhdHRlcm4gVGhlIG1hdGNoIHBhdHRlcm4gdG8gcGFyc2UuXG5cdCovXG5cdGNvbnN0cnVjdG9yKG1hdGNoUGF0dGVybikge1xuXHRcdGlmIChtYXRjaFBhdHRlcm4gPT09IFwiPGFsbF91cmxzPlwiKSB7XG5cdFx0XHR0aGlzLmlzQWxsVXJscyA9IHRydWU7XG5cdFx0XHR0aGlzLnByb3RvY29sTWF0Y2hlcyA9IFsuLi5NYXRjaFBhdHRlcm4uUFJPVE9DT0xTXTtcblx0XHRcdHRoaXMuaG9zdG5hbWVNYXRjaCA9IFwiKlwiO1xuXHRcdFx0dGhpcy5wYXRobmFtZU1hdGNoID0gXCIqXCI7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGNvbnN0IGdyb3VwcyA9IC8oLiopOlxcL1xcLyguKj8pKFxcLy4qKS8uZXhlYyhtYXRjaFBhdHRlcm4pO1xuXHRcdFx0aWYgKGdyb3VwcyA9PSBudWxsKSB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihtYXRjaFBhdHRlcm4sIFwiSW5jb3JyZWN0IGZvcm1hdFwiKTtcblx0XHRcdGNvbnN0IFtfLCBwcm90b2NvbCwgaG9zdG5hbWUsIHBhdGhuYW1lXSA9IGdyb3Vwcztcblx0XHRcdHZhbGlkYXRlUHJvdG9jb2wobWF0Y2hQYXR0ZXJuLCBwcm90b2NvbCk7XG5cdFx0XHR2YWxpZGF0ZUhvc3RuYW1lKG1hdGNoUGF0dGVybiwgaG9zdG5hbWUpO1xuXHRcdFx0dGhpcy5wcm90b2NvbE1hdGNoZXMgPSBwcm90b2NvbCA9PT0gXCIqXCIgPyBbXCJodHRwXCIsIFwiaHR0cHNcIl0gOiBbcHJvdG9jb2xdO1xuXHRcdFx0dGhpcy5ob3N0bmFtZU1hdGNoID0gaG9zdG5hbWU7XG5cdFx0XHR0aGlzLnBhdGhuYW1lTWF0Y2ggPSBwYXRobmFtZTtcblx0XHR9XG5cdH1cblx0LyoqIENoZWNrIGlmIGEgVVJMIGlzIGluY2x1ZGVkIGluIGEgcGF0dGVybi4gKi9cblx0aW5jbHVkZXModXJsKSB7XG5cdFx0Y29uc3QgdSA9IHR5cGVvZiB1cmwgPT09IFwic3RyaW5nXCIgPyBuZXcgVVJMKHVybCkgOiB1cmwgaW5zdGFuY2VvZiBMb2NhdGlvbiA/IG5ldyBVUkwodXJsLmhyZWYpIDogdXJsO1xuXHRcdGlmICh0aGlzLmlzQWxsVXJscykgcmV0dXJuICF0aGlzLmlzVW5rbm93blByb3RvY29sKHUpO1xuXHRcdHJldHVybiAhIXRoaXMucHJvdG9jb2xNYXRjaGVzLmZpbmQoKHByb3RvY29sKSA9PiB7XG5cdFx0XHRpZiAocHJvdG9jb2wgPT09IFwiaHR0cFwiKSByZXR1cm4gdGhpcy5pc0h0dHBNYXRjaCh1KTtcblx0XHRcdGlmIChwcm90b2NvbCA9PT0gXCJodHRwc1wiKSByZXR1cm4gdGhpcy5pc0h0dHBzTWF0Y2godSk7XG5cdFx0XHRpZiAocHJvdG9jb2wgPT09IFwiZmlsZVwiKSByZXR1cm4gdGhpcy5pc0ZpbGVNYXRjaCh1KTtcblx0XHRcdGlmIChwcm90b2NvbCA9PT0gXCJmdHBcIikgcmV0dXJuIHRoaXMuaXNGdHBNYXRjaCh1KTtcblx0XHRcdGlmIChwcm90b2NvbCA9PT0gXCJ1cm5cIikgcmV0dXJuIHRoaXMuaXNVcm5NYXRjaCh1KTtcblx0XHR9KTtcblx0fVxuXHRpc0h0dHBNYXRjaCh1cmwpIHtcblx0XHRyZXR1cm4gdXJsLnByb3RvY29sID09PSBcImh0dHA6XCIgJiYgdGhpcy5pc0hvc3RQYXRoTWF0Y2godXJsKTtcblx0fVxuXHRpc0h0dHBzTWF0Y2godXJsKSB7XG5cdFx0cmV0dXJuIHVybC5wcm90b2NvbCA9PT0gXCJodHRwczpcIiAmJiB0aGlzLmlzSG9zdFBhdGhNYXRjaCh1cmwpO1xuXHR9XG5cdGlzSG9zdFBhdGhNYXRjaCh1cmwpIHtcblx0XHRpZiAoIXRoaXMuaG9zdG5hbWVNYXRjaCB8fCAhdGhpcy5wYXRobmFtZU1hdGNoKSByZXR1cm4gZmFsc2U7XG5cdFx0Y29uc3QgaG9zdG5hbWVNYXRjaFJlZ2V4cyA9IFt0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLmhvc3RuYW1lTWF0Y2gpLCB0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLmhvc3RuYW1lTWF0Y2gucmVwbGFjZSgvXlxcKlxcLi8sIFwiXCIpKV07XG5cdFx0Y29uc3QgcGF0aG5hbWVNYXRjaFJlZ2V4ID0gdGhpcy5jb252ZXJ0UGF0dGVyblRvUmVnZXgodGhpcy5wYXRobmFtZU1hdGNoKTtcblx0XHRyZXR1cm4gISFob3N0bmFtZU1hdGNoUmVnZXhzLmZpbmQoKHJlZ2V4KSA9PiByZWdleC50ZXN0KHVybC5ob3N0bmFtZSkpICYmIHBhdGhuYW1lTWF0Y2hSZWdleC50ZXN0KHVybC5wYXRobmFtZSk7XG5cdH1cblx0aXNVbmtub3duUHJvdG9jb2wodXJsKSB7XG5cdFx0cmV0dXJuICF0aGlzLnByb3RvY29sTWF0Y2hlcy5pbmNsdWRlcyh1cmwucHJvdG9jb2wuc2xpY2UoMCwgLTEpKTtcblx0fVxuXHRpc1BhdGhNYXRjaCh1cmwpIHtcblx0XHRpZiAoIXRoaXMucGF0aG5hbWVNYXRjaCkgcmV0dXJuIGZhbHNlO1xuXHRcdHJldHVybiB0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLnBhdGhuYW1lTWF0Y2gpLnRlc3QodXJsLnBhdGhuYW1lKTtcblx0fVxuXHRpc0ZpbGVNYXRjaCh1cmwpIHtcblx0XHRyZXR1cm4gdXJsLnByb3RvY29sID09PSBcImZpbGU6XCIgJiYgdGhpcy5pc1BhdGhNYXRjaCh1cmwpO1xuXHR9XG5cdGlzRnRwTWF0Y2goX3VybCkge1xuXHRcdHRocm93IEVycm9yKFwiTm90IGltcGxlbWVudGVkOiBmdHA6Ly8gcGF0dGVybiBtYXRjaGluZy4gT3BlbiBhIFBSIHRvIGFkZCBzdXBwb3J0XCIpO1xuXHR9XG5cdGlzVXJuTWF0Y2goX3VybCkge1xuXHRcdHRocm93IEVycm9yKFwiTm90IGltcGxlbWVudGVkOiB1cm46Ly8gcGF0dGVybiBtYXRjaGluZy4gT3BlbiBhIFBSIHRvIGFkZCBzdXBwb3J0XCIpO1xuXHR9XG5cdGNvbnZlcnRQYXR0ZXJuVG9SZWdleChwYXR0ZXJuKSB7XG5cdFx0Y29uc3Qgc3RhcnNSZXBsYWNlZCA9IHRoaXMuZXNjYXBlRm9yUmVnZXgocGF0dGVybikucmVwbGFjZSgvXFxcXFxcKi9nLCBcIi4qXCIpO1xuXHRcdHJldHVybiBSZWdFeHAoYF4ke3N0YXJzUmVwbGFjZWR9JGApO1xuXHR9XG5cdGVzY2FwZUZvclJlZ2V4KHN0cmluZykge1xuXHRcdHJldHVybiBzdHJpbmcucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpO1xuXHR9XG59O1xudmFyIEludmFsaWRNYXRjaFBhdHRlcm4gPSBjbGFzcyBleHRlbmRzIEVycm9yIHtcblx0Y29uc3RydWN0b3IobWF0Y2hQYXR0ZXJuLCByZWFzb24pIHtcblx0XHRzdXBlcihgSW52YWxpZCBtYXRjaCBwYXR0ZXJuIFwiJHttYXRjaFBhdHRlcm59XCI6ICR7cmVhc29ufWApO1xuXHR9XG59O1xuZnVuY3Rpb24gdmFsaWRhdGVQcm90b2NvbChtYXRjaFBhdHRlcm4sIHByb3RvY29sKSB7XG5cdGlmICghTWF0Y2hQYXR0ZXJuLlBST1RPQ09MUy5pbmNsdWRlcyhwcm90b2NvbCkgJiYgcHJvdG9jb2wgIT09IFwiKlwiKSB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihtYXRjaFBhdHRlcm4sIGAke3Byb3RvY29sfSBub3QgYSB2YWxpZCBwcm90b2NvbCAoJHtNYXRjaFBhdHRlcm4uUFJPVE9DT0xTLmpvaW4oXCIsIFwiKX0pYCk7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZUhvc3RuYW1lKG1hdGNoUGF0dGVybiwgaG9zdG5hbWUpIHtcblx0aWYgKGhvc3RuYW1lLmluY2x1ZGVzKFwiOlwiKSkgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4obWF0Y2hQYXR0ZXJuLCBgSG9zdG5hbWUgY2Fubm90IGluY2x1ZGUgYSBwb3J0YCk7XG5cdGlmIChob3N0bmFtZS5pbmNsdWRlcyhcIipcIikgJiYgaG9zdG5hbWUubGVuZ3RoID4gMSAmJiAhaG9zdG5hbWUuc3RhcnRzV2l0aChcIiouXCIpKSB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihtYXRjaFBhdHRlcm4sIGBJZiB1c2luZyBhIHdpbGRjYXJkICgqKSwgaXQgbXVzdCBnbyBhdCB0aGUgc3RhcnQgb2YgdGhlIGhvc3RuYW1lYCk7XG59XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IEludmFsaWRNYXRjaFBhdHRlcm4sIE1hdGNoUGF0dGVybiB9O1xuIl0sImlnbm9yZUxpc3QiOlswLDEsMiw1XSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Q0NnQkEsSUFBTSxVRGZpQixXQUFXLFNBQVMsU0FBUyxLQUNoRCxXQUFXLFVBQ1gsV0FBVzs7Q0VGZixTQUFTLGlCQUFpQixLQUFLO0VBQzlCLElBQUksT0FBTyxRQUFRLE9BQU8sUUFBUSxZQUFZLE9BQU8sRUFBRSxNQUFNLElBQUk7RUFDakUsT0FBTztDQUNSOzs7Ozs7Q0NBQSxJQUFNLGtDQUFrQixJQUFJLElBQUk7RUFDOUI7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0NBQ0YsQ0FBQztDQUVELElBQU0sa0NBQWtCLElBQUksSUFBSSxDQUFDLGFBQWEsdUJBQXVCLENBQUM7Q0FPdEUsU0FBUyxnQkFBZ0IsTUFBK0I7RUFDdEQsTUFBTSxRQUFRLEtBQUssTUFBTSxHQUFHO0VBQzVCLElBQUksTUFBTSxXQUFXLEdBQUcsT0FBTztFQUMvQixNQUFNLFNBQW1CLENBQUM7RUFDMUIsS0FBSyxNQUFNLFFBQVEsT0FBTztHQUN4QixJQUFJLENBQUMsWUFBWSxLQUFLLElBQUksR0FBRyxPQUFPO0dBQ3BDLE1BQU0sSUFBSSxPQUFPLElB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