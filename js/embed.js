(function () {
  var DEFAULT_FRAME_STYLE =
    "border:0; border-radius:0; position:fixed; right:max(8px,2vw); bottom:max(8px,2vw); z-index:999999; background:transparent; box-shadow:none; overflow:hidden;";
  var EMBED_TAG = "journey-builder-avatar";

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

  function buildAvatarUrls(params, scriptUrl) {
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

  function getAttributeValue(element, names) {
    for (var i = 0; i < names.length; i += 1) {
      var value = element.getAttribute(names[i]);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }

  function mergeElementParams(baseParams, element) {
    var merged = new URLSearchParams(baseParams.toString());
    var paramMappings = [
      { keys: ["flow_id", "flow-id", "flowId"], param: "flowId" },
      { keys: ["host_url", "host-url", "hostUrl"], param: "hostUrl" },
      { keys: ["api_key", "api-key", "apiKey"], param: "apiKey" },
      { keys: ["prompt"], param: "prompt" },
      { keys: ["speech_region", "speech-region", "speechRegion"], param: "speechRegion" },
      { keys: ["speech_api_key", "speech-api-key", "speechApiKey"], param: "speechApiKey" },
      {
        keys: ["speech_private_endpoint", "speech-private-endpoint", "speechPrivateEndpoint"],
        param: "speechPrivateEndpoint",
      },
      { keys: ["tts_voice", "tts-voice", "ttsVoice"], param: "ttsVoice" },
      { keys: ["avatar_character", "avatar-character", "avatarCharacter"], param: "avatarCharacter" },
      { keys: ["avatar_style", "avatar-style", "avatarStyle"], param: "avatarStyle" },
      { keys: ["auto_start", "auto-start", "autoStart"], param: "autoStart" },
      { keys: ["view"], param: "view" },
      { keys: ["v"], param: "v" },
      { keys: ["chat_url", "chat-url", "chatUrl"], param: "chatUrl" },
    ];

    paramMappings.forEach(function (mapping) {
      var value = getAttributeValue(element, mapping.keys);
      if (value !== null) {
        merged.set(mapping.param, value);
      }
    });

    return merged;
  }

  function getIframeConfig(scriptUrl, element) {
    var getParamOrAttr = function (queryKey, attrNames, fallbackValue) {
      var attrValue = element ? getAttributeValue(element, attrNames) : null;
      if (attrValue !== null) {
        return attrValue;
      }
      return scriptUrl.searchParams.get(queryKey) || fallbackValue;
    };

    return {
      title: getParamOrAttr("title", ["title"], "Journey Builder Avatar"),
      width: getParamOrAttr("width", ["width"], "84"),
      height: getParamOrAttr("height", ["height"], "84"),
      allow: getParamOrAttr("allow", ["allow"], "microphone"),
      style: getParamOrAttr("style", ["style"], DEFAULT_FRAME_STYLE),
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

  function createIframe(scriptTag, iframeConfig, targetElement) {
    var iframe = document.createElement("iframe");

    iframe.setAttribute("title", iframeConfig.title);
    iframe.setAttribute("width", iframeConfig.width);
    iframe.setAttribute("height", iframeConfig.height);
    iframe.setAttribute("allow", iframeConfig.allow);
    iframe.style.cssText = iframeConfig.style;

    if (targetElement && targetElement.parentNode) {
      targetElement.parentNode.replaceChild(iframe, targetElement);
    } else {
      scriptTag.parentNode.insertBefore(iframe, scriptTag);
    }
    return iframe;
  }

  function mount(scriptTag, targetElement) {
    var scriptUrl = new URL(scriptTag.src, window.location.href);
    var baseParams = new URLSearchParams(scriptUrl.search);
    var mergedParams = targetElement
      ? mergeElementParams(baseParams, targetElement)
      : baseParams;
    var iframeConfig = getIframeConfig(scriptUrl, targetElement);
    var iframe = createIframe(scriptTag, iframeConfig, targetElement);
    var avatarUrls = buildAvatarUrls(mergedParams, scriptUrl);

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

    var embedTargets = document.querySelectorAll(EMBED_TAG);
    if (!embedTargets.length) {
      mount(scriptTag, null);
      return;
    }

    Array.prototype.forEach.call(embedTargets, function (targetElement) {
      mount(scriptTag, targetElement);
    });
  } catch (error) {
    console.error("[Journey Builder Avatar] Unable to initialize embed:", error);
  }
})();
