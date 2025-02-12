import { isString } from '@tubular/util';
import compareVersions, { CompareOperator } from 'compare-versions';

export function safeCompareVersions(firstVersion: string, secondVersion: string, defValue?: number): number;
export function safeCompareVersions(firstVersion: string, secondVersion: string, operator?: CompareOperator, defValue?: boolean): boolean;
export function safeCompareVersions(firstVersion: string, secondVersion: string,
                                    operatorOrDefValue: CompareOperator | number, defValue = false): number | boolean {
  try {
    if (isString(operatorOrDefValue))
      return compareVersions.compare(firstVersion, secondVersion, operatorOrDefValue);
    else {
      /* false inspection alarm */ // noinspection JSUnusedAssignment
      operatorOrDefValue = operatorOrDefValue ?? -1;

      return compareVersions(firstVersion, secondVersion);
    }
  }
  catch {}

  return isString(operatorOrDefValue) ? defValue : operatorOrDefValue;
}
