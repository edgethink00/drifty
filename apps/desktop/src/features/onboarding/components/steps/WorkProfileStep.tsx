import { WORK_DOMAIN_OPTIONS, WORK_TYPE_OPTIONS } from "../../constants";
import { Dropdown } from "../Dropdown";

type WorkProfileStepProps = {
  readonly workDomain: string | null;
  readonly workDomainOther: string;
  readonly workType: string | null;
  readonly workTypeOther: string;
  readonly onWorkDomainChange: (value: string | null) => void;
  readonly onWorkDomainOtherChange: (value: string) => void;
  readonly onWorkTypeChange: (value: string | null) => void;
  readonly onWorkTypeOtherChange: (value: string) => void;
};

export function WorkProfileStep({
  workDomain,
  workDomainOther,
  workType,
  workTypeOther,
  onWorkDomainChange,
  onWorkDomainOtherChange,
  onWorkTypeChange,
  onWorkTypeOtherChange,
}: WorkProfileStepProps) {
  return (
    <>
      <Dropdown
        options={WORK_TYPE_OPTIONS}
        value={workType}
        onChange={onWorkTypeChange}
        placeholder="What's your role?"
        otherText={workTypeOther}
        onOtherTextChange={onWorkTypeOtherChange}
        searchable
        ariaLabel="Your role"
      />
      <Dropdown
        options={WORK_DOMAIN_OPTIONS}
        value={workDomain}
        onChange={onWorkDomainChange}
        placeholder="What field do you work in?"
        otherText={workDomainOther}
        onOtherTextChange={onWorkDomainOtherChange}
        searchable
        ariaLabel="Your field"
      />
    </>
  );
}
