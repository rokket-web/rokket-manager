import type { Field } from "@/components/forms/field-form";

export const PROJECT_STATUS_OPTIONS = [
  { value: "PLANNING", label: "Planning" },
  { value: "ACTIVE", label: "Active" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export const BILLING_TYPE_OPTIONS = [
  { value: "HOURLY", label: "Hourly (bill logged time)" },
  { value: "FLAT_FEE", label: "Flat fee (bill in installments)" },
];

export function projectFields(clients: { id: string; name: string }[] | null): Field[] {
  return [
    ...(clients
      ? [
          {
            name: "clientId",
            label: "Client",
            type: "select" as const,
            required: true,
            options: [
              { value: "", label: "Select a client..." },
              ...clients.map((c) => ({ value: c.id, label: c.name })),
            ],
          },
        ]
      : []),
    { name: "name", label: "Project name", required: true },
    { name: "status", label: "Status", type: "select", options: PROJECT_STATUS_OPTIONS },
    { name: "billingType", label: "Billing", type: "select", options: BILLING_TYPE_OPTIONS },
    { name: "flatFee", label: "Flat fee (USD)", hint: "Required for flat-fee projects, e.g. 12000" },
    { name: "description", label: "Description", type: "textarea" },
    { name: "budget", label: "Budget (USD)", hint: "Optional, e.g. 5000 or 5000.00" },
    { name: "hourlyRate", label: "Hourly rate (USD)", hint: "Used for new time entries and hourly billing, e.g. 95" },
    { name: "startDate", label: "Start date", type: "date" },
    { name: "dueDate", label: "Due date", type: "date" },
  ];
}

export const milestoneFields: Field[] = [
  { name: "title", label: "Milestone", required: true },
  {
    name: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "PENDING", label: "Pending" },
      { value: "IN_PROGRESS", label: "In progress" },
      { value: "COMPLETED", label: "Completed" },
    ],
  },
  { name: "dueDate", label: "Due date", type: "date" },
  { name: "billable", label: "Billable amount (USD)", hint: "Optional, used for invoicing later" },
  { name: "description", label: "Description", type: "textarea" },
];

export function taskFields(
  members: { id: string; name: string }[],
  milestones: { id: string; title: string }[],
): Field[] {
  return [
    { name: "title", label: "Task", required: true, wide: true },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "TODO", label: "To do" },
        { value: "IN_PROGRESS", label: "In progress" },
        { value: "REVIEW", label: "Review" },
        { value: "DONE", label: "Done" },
      ],
    },
    {
      name: "priority",
      label: "Priority",
      type: "select",
      options: [
        { value: "LOW", label: "Low" },
        { value: "MEDIUM", label: "Medium" },
        { value: "HIGH", label: "High" },
        { value: "URGENT", label: "Urgent" },
      ],
    },
    {
      name: "assigneeId",
      label: "Assignee",
      type: "select",
      options: [{ value: "", label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.name }))],
    },
    {
      name: "milestoneId",
      label: "Milestone",
      type: "select",
      options: [{ value: "", label: "None" }, ...milestones.map((m) => ({ value: m.id, label: m.title }))],
    },
    { name: "dueDate", label: "Due date", type: "date" },
    { name: "description", label: "Description", type: "textarea" },
  ];
}
