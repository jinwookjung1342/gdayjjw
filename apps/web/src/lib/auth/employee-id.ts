export const EMPLOYEE_ID_REGEX = /^[0-9]{2}[A-Za-z]{1,2}[0-9]{4,5}$/;

export function validateEmployeeCredentials(employeeId: string, password: string) {
  const normalized = employeeId.trim().toUpperCase();
  const isValidId = EMPLOYEE_ID_REGEX.test(normalized);
  const passwordMatches = normalized === password.trim().toUpperCase();

  return {
    isValid: isValidId && passwordMatches,
    normalized,
    message: !isValidId
      ? "사번 형식이 올바르지 않습니다. 예: 21W00035 / 21WJ00035"
      : !passwordMatches
        ? "초기 정책상 비밀번호는 사번과 동일해야 합니다."
        : ""
  };
}
