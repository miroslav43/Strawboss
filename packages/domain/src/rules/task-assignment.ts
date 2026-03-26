export interface AssignmentValidationInput {
  machineId: string;
  assignedUserId: string;
  assignmentDate: string;
  existingAssignments: Array<{
    machineId: string;
    assignedUserId: string;
    assignmentDate: string;
  }>;
}

export interface AssignmentValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateTaskAssignment(
  input: AssignmentValidationInput,
): AssignmentValidationResult {
  const { machineId, assignedUserId, assignmentDate, existingAssignments } =
    input;
  const errors: string[] = [];

  // Check: machine not double-booked on the same date
  const machineConflict = existingAssignments.find(
    (a) => a.machineId === machineId && a.assignmentDate === assignmentDate,
  );
  if (machineConflict) {
    errors.push(
      `Machine ${machineId} is already assigned on ${assignmentDate}`,
    );
  }

  // Check: user not double-booked on the same date
  const userConflict = existingAssignments.find(
    (a) =>
      a.assignedUserId === assignedUserId &&
      a.assignmentDate === assignmentDate,
  );
  if (userConflict) {
    errors.push(
      `User ${assignedUserId} is already assigned on ${assignmentDate}`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
