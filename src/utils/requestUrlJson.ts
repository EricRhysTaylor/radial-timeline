import { requestUrl } from 'obsidian';

export interface JsonHttpResponse {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}

export async function requestJson(url: string): Promise<JsonHttpResponse> {
    const response = await requestUrl({
        url,
        method: 'GET',
        throw: false,
    });

    return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => JSON.parse(response.text),
    };
}
