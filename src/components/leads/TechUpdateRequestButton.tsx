import UpdateRequestButton from "./UpdateRequestButton";

export default function TechUpdateRequestButton(props: { leadId: string; customerName: string; className?: string }) {
  return <UpdateRequestButton kind="tech" {...props} />;
}
