import type { Accessor } from "solid-js";
import { autoLanguageCode, languageOptions } from "./types";

type LanguageFieldsProps = {
    myLanguageCode: Accessor<string>;
    setMyLanguageCode: (value: string) => void;
    companionLanguageCode: Accessor<string>;
    setCompanionLanguageCode: (value: string) => void;
    disabled: Accessor<boolean>;
};

export function LanguageFields(props: LanguageFieldsProps) {
    return (
        <div class="language-fields">
            <label class="field" for="my-language-select">
                <span>My Language</span>
                <select
                    id="my-language-select"
                    value={props.myLanguageCode()}
                    disabled={props.disabled()}
                    onInput={(event) => props.setMyLanguageCode(event.currentTarget.value)}
                >
                    {languageOptions.map(([code, label]) => (
                        <option value={code}>{label}</option>
                    ))}
                </select>
            </label>
            <label class="field" for="companion-language-select">
                <span>Companion Language</span>
                <select
                    id="companion-language-select"
                    value={props.companionLanguageCode()}
                    disabled={props.disabled()}
                    onInput={(event) => props.setCompanionLanguageCode(event.currentTarget.value)}
                >
                    <option value={autoLanguageCode}>Auto</option>
                    {languageOptions.map(([code, label]) => (
                        <option value={code}>{label}</option>
                    ))}
                </select>
            </label>
        </div>
    );
}
