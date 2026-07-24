/**
 * The many-to-many link between a transporter user (UserRole.transportator) and
 * the beneficiaries an admin has allowed them to act for.
 *
 * A transporter may only submit requests — and only sees saved
 * contacts/trucks/drivers — for beneficiaries they are assigned to. The backend
 * enforces this on every write via `assertAssigned(orgId, userId, beneficiaryId)`,
 * the authenticated analogue of the public portal's daily-PIN check.
 *
 * Membership is set-replace (hard delete): removing an assignment deletes the row.
 * There is no soft-delete because nothing FKs to this table — a submitted
 * `trip_requests` row keeps the beneficiary snapshot regardless of later membership.
 */
export interface TransporterBeneficiary {
  id: string;
  organizationId: string;
  transporterUserId: string;
  beneficiaryId: string;
  createdAt: string;
}
