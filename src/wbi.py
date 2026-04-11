# -*- coding: utf-8 -*-
"""
Bilibili WBI 签名算法。
"""

from __future__ import annotations

from functools import lru_cache
import hashlib
import time
import urllib.parse

import requests

import config


MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]


def _response_to_json(resp: requests.Response, api_name: str) -> dict:
    try:
        return resp.json()
    except ValueError as exc:
        snippet = resp.text[:200].strip().replace("\n", " ")
        raise RuntimeError(
            f"{api_name} 返回了非 JSON 内容，状态码 {resp.status_code}，内容片段: {snippet or '<empty>'}"
        ) from exc


def _get_mixin_key(orig: str) -> str:
    return "".join(orig[i] for i in MIXIN_KEY_ENC_TAB)[:32]


@lru_cache(maxsize=1)
def _get_wbi_keys() -> tuple[str, str]:
    resp = requests.get(config.API_NAV, headers=config.BASE_HEADERS, timeout=10)
    data = _response_to_json(resp, "WBI NAV 接口").get("data", {})

    img_url = data["wbi_img"]["img_url"]
    sub_url = data["wbi_img"]["sub_url"]
    img_key = img_url.rsplit("/", 1)[-1].split(".")[0]
    sub_key = sub_url.rsplit("/", 1)[-1].split(".")[0]
    return img_key, sub_key


def sign_params(params: dict) -> dict:
    img_key, sub_key = _get_wbi_keys()
    mixin_key = _get_mixin_key(img_key + sub_key)

    params = dict(params)
    params["wts"] = int(time.time())
    params = dict(sorted(params.items()))

    query = urllib.parse.urlencode(params).replace("+", "%20")
    params["w_rid"] = hashlib.md5((query + mixin_key).encode("utf-8")).hexdigest()
    return params
