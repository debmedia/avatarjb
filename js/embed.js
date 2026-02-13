(function () {
  var DEFAULT_FRAME_STYLE =
    "border:0; border-radius:0; position:fixed; right:max(8px,2vw); bottom:max(8px,2vw); z-index:999999; background:transparent; box-shadow:none; overflow:hidden;";

  function stripQueryAndHash(url) {
    var raw = String(url || "");
    var hashIndex = raw.indexOf("#");
    var withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    var queryIndex = withoutHash.indexOf("?");
    return queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  }

  function getAssetBaseUrl(chatHtmlUrl) {
    var normalized = stripQueryAndHash(chatHtmlUrl);
    var slashIndex = normalized.lastIndexOf("/");
    return slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : normalized;
  }

  function isJsDelivrHtmlUrl(url) {
    var normalized = stripQueryAndHash(url).toLowerCase();
    return (
      normalized.indexOf("cdn.jsdelivr.net/") >= 0 &&
      normalized.slice(-5) === ".html"
    );
  }

  function buildAvatarUrls(scriptUrl) {
    var params = new URLSearchParams(scriptUrl.search);
    var explicitChatUrl = params.get("chatUrl") || params.get("chat_url");
    var chatHtmlUrl = explicitChatUrl
      ? stripQueryAndHash(explicitChatUrl)
      : stripQueryAndHash(new URL("../chat.html", scriptUrl).toString());

    [
      "chatUrl",
      "chat_url",
      "width",
      "height",
      "title",
      "allow",
      "style",
    ].forEach(function (name) {
      params.delete(name);
    });

    var serializedParams = params.toString();
    var queryString = serializedParams ? "?" + serializedParams : "";
    return {
      chatHtmlUrl: chatHtmlUrl,
      avatarUrl: chatHtmlUrl + queryString,
      queryString: queryString,
      assetBaseUrl: getAssetBaseUrl(chatHtmlUrl),
    };
  }

  function patchHtml(html, assetBaseUrl, queryString) {
    var hasBaseTag = /<base\s/i.test(html);
    var baseTag = hasBaseTag ? "" : '<base href="' + assetBaseUrl + '">';
    var configTag =
      "<script>(function(){var q=" +
      JSON.stringify(queryString) +
      ';window.__JB_AVATAR_QUERY__=q;try{if(q){history.replaceState(null,"",q);}}catch(_e){}})();<\/script>';
    var bootstrap = baseTag + configTag;
    var headOpenTagRegex = /<head[^>]*>/i;

    if (headOpenTagRegex.test(html)) {
      return html.replace(headOpenTagRegex, function (match) {
        return match + bootstrap;
      });
    }

    if (html.indexOf("</head>") >= 0) {
      return html.replace("</head>", bootstrap + "</head>");
    }

    return bootstrap + html;
  }

  function createIframe(scriptTag, scriptUrl) {
    var params = scriptUrl.searchParams;
    var iframe = document.createElement("iframe");

    iframe.setAttribute("title", params.get("title") || "Journey Builder Avatar");
    iframe.setAttribute("width", params.get("width") || "84");
    iframe.setAttribute("height", params.get("height") || "84");
    iframe.setAttribute("allow", params.get("allow") || "microphone");
    iframe.style.cssText = params.get("style") || DEFAULT_FRAME_STYLE;

    scriptTag.parentNode.insertBefore(iframe, scriptTag);
    return iframe;
  }

  function mount(scriptTag) {
    var scriptUrl = new URL(scriptTag.src, window.location.href);
    var iframe = createIframe(scriptTag, scriptUrl);
    var avatarUrls = buildAvatarUrls(scriptUrl);

    if (!isJsDelivrHtmlUrl(avatarUrls.chatHtmlUrl)) {
      iframe.setAttribute("src", avatarUrls.avatarUrl);
      return;
    }

    fetch(avatarUrls.chatHtmlUrl, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.text();
      })
      .then(function (html) {
        iframe.setAttribute(
          "srcdoc",
          patchHtml(html, avatarUrls.assetBaseUrl, avatarUrls.queryString)
        );
      })
      .catch(function (error) {
        console.warn("[Journey Builder Avatar] CDN srcdoc fallback:", error);
        iframe.setAttribute("src", avatarUrls.avatarUrl);
      });
  }

  try {
    var scriptTag = document.currentScript;
    if (!scriptTag || !scriptTag.parentNode) {
      return;
    }

    mount(scriptTag);
  } catch (error) {
    console.error("[Journey Builder Avatar] Unable to initialize embed:", error);
  }
})();
