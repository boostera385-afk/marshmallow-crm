import UpdateRequestButton from "./UpdateRequestButton";

export default function CxUpdateRequestButton(props: { leadId: string; customerName: string; className?: string }) {
  return <UpdateRequestButton kind="cx" {...props} />;
}
