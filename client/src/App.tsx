import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Solutions from "./pages/Solutions";
import Features from "./pages/Features";
import UseCases from "./pages/UseCases";
import About from "./pages/About";
import Partners from "./pages/Partners";
import GrantsManagement from "./pages/GrantsManagement";
import ScholarshipsManagement from "./pages/ScholarshipsManagement";
import FellowshipsManagement from "./pages/FellowshipsManagement";
import ResearchManagement from "./pages/ResearchManagement";
import EducationManagement from "./pages/EducationManagement";
import PortfolioManagement from "./pages/PortfolioManagement";
import HumanitarianAI from "./pages/HumanitarianAI";
import ProcessIntelligence from "./pages/ProcessIntelligence";
import DigitalTransformation from "./pages/DigitalTransformation";
import GovernmentServices from "./pages/GovernmentServices";
import AIAutomation from "./pages/AIAutomation";
import FederalProjects from "./pages/FederalProjects";
import BookDemo from "./pages/BookDemo";
import TalkToExpert from "./pages/TalkToExpert";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import BlogCategory from "./pages/BlogCategory";
import BlogTag from "./pages/BlogTag";
import AuthorProfile from "./pages/AuthorProfile";
import AdminBlog from "./pages/AdminBlog";
import AdminCMS from "./pages/AdminCMS";
import AdminMedia from "./pages/AdminMedia";
import AdminImport from "./pages/AdminImport";
import AdminImportHistory from "./pages/AdminImportHistory";
import AdminCalendar from "./pages/AdminCalendar";
import AdminComments from "./pages/AdminComments";
import AdminAnalytics from "./pages/AdminAnalytics";
import AdminContentAnalytics from "./pages/AdminContentAnalytics";
import AdminSubscribers from "./pages/AdminSubscribers";
import AdminCategories from "@/pages/AdminCategories";
import AdminTags from "./pages/AdminTags";
import AdminSchedule from "./pages/AdminSchedule";
import AdminUsers from "./pages/AdminUsers";
import AdminAuditLog from "./pages/AdminAuditLog";
import AdminPages from "./pages/AdminPages";
import NotificationPreferences from "./pages/NotificationPreferences";
import Preferences from "./pages/Preferences";
import AdminMenus from "./pages/AdminMenus";
import AdminBlogSeries from "./pages/AdminBlogSeries";
import BlogSeries from "./pages/BlogSeries";
import AdminPostTypes from "./pages/AdminPostTypes";
import AdminPostTypeItems from "./pages/AdminPostTypeItems";
import AdminProfile from "./pages/AdminProfile";
import AdminCustomFields from "./pages/admin/custom-fields";
import PagePreview from "./pages/PagePreview";
import CMSPage from "./pages/CMSPage";
import Login from "./pages/Login";

/* Federal Modernism Design: Light theme with navy/red color scheme */

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/login"} component={Login} />
      <Route path={"/solutions"} component={Solutions} />
      <Route path={"/solutions/grants"} component={GrantsManagement} />
      <Route path={"/solutions/scholarships"} component={ScholarshipsManagement} />
      <Route path={"/solutions/fellowships"} component={FellowshipsManagement} />
      <Route path={"/solutions/research"} component={ResearchManagement} />
      <Route path={"/partners"} component={Partners} />
      <Route path={"/partners/education"} component={EducationManagement} />
      <Route path={"/partners/portfolio"} component={PortfolioManagement} />
      <Route path={"/partners/humanitarian-ai"} component={HumanitarianAI} />
      <Route path={"/partners/process-intelligence"} component={ProcessIntelligence} />
      <Route path={"/partners/digital-transformation"} component={DigitalTransformation} />
      <Route path={"/government-services"} component={GovernmentServices} />
      <Route path={"/government-services/ai-automation"} component={AIAutomation} />
      <Route path={"/government-services/federal-projects"} component={FederalProjects} />
      <Route path={"/features"} component={Features} />
      <Route path={"/use-cases"} component={UseCases} />
      <Route path={"/about"} component={About} />
      <Route path={"/contact/demo"} component={BookDemo} />
      <Route path={"/contact/expert"} component={TalkToExpert} />
      <Route path={"/blog"} component={Blog} />
      <Route path={"/blog/category/:slug"} component={BlogCategory} />
      <Route path={"/blog/tag/:slug"} component={BlogTag} />
      <Route path={"/series/:slug"} component={BlogSeries} />
      <Route path={"/blog/:slug"} component={BlogPost} />
      <Route path={"/author/:id"} component={AuthorProfile} />
      <Route path={"/preferences"} component={Preferences} />
      <Route path={"/admin/blog"} component={AdminBlog} />
      <Route path={"/admin/series"} component={AdminBlogSeries} />
      <Route path={"/admin/cms"} component={AdminCMS} />
      <Route path={"/admin/media"} component={AdminMedia} />
      <Route path={"/admin/import"} component={AdminImport} />
      <Route path={"/admin/import-history"} component={AdminImportHistory} />
      <Route path={"/admin/calendar"} component={AdminCalendar} />
      <Route path={"/admin/comments"} component={AdminComments} />
      <Route path={"/admin/analytics"} component={AdminAnalytics} />
      <Route path={"/admin/content-analytics"} component={AdminContentAnalytics} />
      <Route path={"/admin/subscribers"} component={AdminSubscribers} />
          <Route path="/admin/categories" component={AdminCategories} />
          <Route path="/admin/tags" component={AdminTags} />
          <Route path="/admin/schedule" component={AdminSchedule} />
          <Route path="/admin/users" component={AdminUsers} />
          <Route path="/admin/audit-log" component={AdminAuditLog} />
          <Route path="/admin/pages" component={AdminPages} />
          <Route path="/admin/notifications" component={NotificationPreferences} />
          <Route path="/admin/menus" component={AdminMenus} />
          <Route path="/admin/post-types" component={AdminPostTypes} />
          <Route path="/admin/post-type/:slug" component={AdminPostTypeItems} />
          <Route path="/admin/custom-fields" component={AdminCustomFields} />
          <Route path="/admin/profile" component={AdminProfile} />
        <Route path="/preview/:token" component={PagePreview} />
        <Route path={"/404"} component={NotFound} />
      {/* Dynamic CMS pages - must be last before 404 */}
      <Route path={"/:slug"} component={CMSPage} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
