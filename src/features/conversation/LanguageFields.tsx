import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { autoLanguageCode, languageLabel, languageOptions } from "./types";

type LanguageFieldsProps = {
    myLanguageCode: string;
    setMyLanguageCode: (value: string) => void;
    companionLanguageCode: string;
    setCompanionLanguageCode: (value: string) => void;
    disabled: boolean;
};

export function LanguageFields({
    myLanguageCode,
    setMyLanguageCode,
    companionLanguageCode,
    setCompanionLanguageCode,
    disabled,
}: LanguageFieldsProps) {
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium" htmlFor="my-language-select">
                <span>My Language</span>
                <Select
                    value={myLanguageCode}
                    onValueChange={(value) => value && setMyLanguageCode(value)}
                    disabled={disabled}
                >
                    <SelectTrigger id="my-language-select" className="w-full">
                        <SelectValue>{(value) => (value ? languageLabel(value) : "Select a language")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {languageOptions.map(([code, label]) => (
                                <SelectItem key={code} value={code}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </label>
            <label className="grid gap-2 text-sm font-medium" htmlFor="companion-language-select">
                <span>Companion Language</span>
                <Select
                    value={companionLanguageCode}
                    onValueChange={(value) => value && setCompanionLanguageCode(value)}
                    disabled={disabled}
                >
                    <SelectTrigger id="companion-language-select" className="w-full">
                        <SelectValue>
                            {(value) =>
                                value === autoLanguageCode ? "Auto" : value ? languageLabel(value) : "Select a language"
                            }
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value={autoLanguageCode}>Auto</SelectItem>
                            {languageOptions.map(([code, label]) => (
                                <SelectItem key={code} value={code}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </label>
        </div>
    );
}
